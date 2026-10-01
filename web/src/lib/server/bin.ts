import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/*
 * Finds and runs the media tools. Each can be overridden with an env var
 * (FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH); otherwise the bundled binaries are used
 * (ffmpeg-static, ffprobe-static, and yt-dlp from `npm run setup:media`), then PATH.
 */

export type BinName = "ffmpeg" | "ffprobe" | "yt-dlp";

const exe = process.platform === "win32" ? ".exe" : "";
const root = () => process.cwd();

function bundled(name: BinName): string {
  switch (name) {
    case "ffmpeg":
      return path.join(root(), "node_modules", "ffmpeg-static", `ffmpeg${exe}`);
    case "ffprobe":
      return path.join(root(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, `ffprobe${exe}`);
    case "yt-dlp":
      return path.join(root(), ".bin", `yt-dlp${exe}`);
  }
}

const ENV: Record<BinName, string> = { ffmpeg: "FFMPEG_PATH", ffprobe: "FFPROBE_PATH", "yt-dlp": "YTDLP_PATH" };

function onPath(name: BinName): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, `${name}${exe}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Absolute path of a tool, or null when it isn't installed. */
export function binPath(name: BinName): string | null {
  const fromEnv = process.env[ENV[name]];
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const local = bundled(name);
  return existsSync(local) ? local : onPath(name);
}

export class ProcessError extends Error {
  constructor(
    readonly bin: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(`${bin} exited with ${exitCode ?? "a signal"}`);
    this.name = "ProcessError";
  }
}

export type RunOptions = {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** Collect stdout (up to this many bytes). Off by default. */
  collectStdout?: number;
  /**
   * Ask the tool to finish early but cleanly (ffmpeg: "q" on stdin), unlike `signal`, which
   * kills it. The run then resolves normally if the tool exits cleanly.
   */
  stopSignal?: AbortSignal;
  /** Extra environment variables for the process. */
  env?: Record<string, string>;
};

const TAIL = 6000;

/** Run a tool with an argument list (never a shell). Rejects with ProcessError on a non-zero exit. */
export function run(name: BinName, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderrTail: string }> {
  const bin = binPath(name);
  if (!bin) return Promise.reject(new ProcessError(name, null, `${name} is not installed`));
  return runProcess(bin, args, opts, name);
}

/** Run a Node script with the same Node that runs the server. */
export function runNode(script: string, args: string[], opts: RunOptions = {}) {
  return runProcess(process.execPath, [script, ...args], opts, "node");
}

function runProcess(bin: string, args: string[], opts: RunOptions, name: string): Promise<{ stdout: string; stderrTail: string }> {
  if (opts.signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      windowsHide: true,
      shell: false,
      stdio: [opts.stopSignal ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderrTail = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const lines = (onLine: ((line: string) => void) | undefined) => {
      let buffer = "";
      return (chunk: Buffer) => {
        if (!onLine) return;
        buffer += chunk.toString("utf8");
        const parts = buffer.split(/\r\n|\n|\r/);
        buffer = parts.pop() ?? "";
        for (const line of parts) if (line) onLine(line);
      };
    };
    const stdoutLines = lines(opts.onStdoutLine);
    const stderrLines = lines(opts.onStderrLine);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (opts.collectStdout && stdout.length < opts.collectStdout) stdout += chunk.toString("utf8");
      stdoutLines(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-TAIL);
      stderrLines(chunk);
    });

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve({ stdout, stderrTail });
    };
    const onAbort = () => {
      killTree(child.pid);
      finish(abortError());
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const onStop = () => {
      child.stdin?.write("q\n");
      child.stdin?.end();
      // Give it a moment to finish its file, then make sure it's gone.
      stopTimer = setTimeout(() => killTree(child.pid), 15_000);
    };
    if (opts.stopSignal?.aborted) onStop();
    else opts.stopSignal?.addEventListener("abort", onStop, { once: true });
    child.on("close", () => {
      if (stopTimer) clearTimeout(stopTimer);
      opts.stopSignal?.removeEventListener("abort", onStop);
    });
    child.stdin?.on("error", () => undefined);
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        killTree(child.pid);
        finish(new ProcessError(name, null, `${stderrTail}\n[timed out after ${opts.timeoutMs} ms]`));
      }, opts.timeoutMs);
    }

    child.on("error", (err) => finish(new ProcessError(name, null, err.message)));
    child.on("close", (code) => finish(code === 0 ? null : new ProcessError(name, code, stderrTail)));
  });
}

/** Stop a process and anything it started (yt-dlp runs ffmpeg as a child). */
function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // Already gone.
  }
}

export function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

export const isAbortError = (err: unknown) => err instanceof Error && err.name === "AbortError";

/* ------------------------------ Versions ------------------------------ */

const versions = new Map<BinName, Promise<string | null>>();

/** The tool's version string (cached), or null when missing or broken. */
export function binVersion(name: BinName): Promise<string | null> {
  let pending = versions.get(name);
  if (!pending) {
    const args = name === "yt-dlp" ? ["--version"] : ["-version"];
    pending = run(name, args, { collectStdout: 4000, timeoutMs: 20_000 })
      .then(({ stdout }) => {
        const first = stdout.trim().split(/\r?\n/)[0] ?? "";
        const match = /version\s+(\S+)/.exec(first);
        return (match?.[1] ?? first).slice(0, 60) || null;
      })
      .catch(() => {
        versions.delete(name);
        return null;
      });
    versions.set(name, pending);
  }
  return pending;
}

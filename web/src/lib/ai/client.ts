import type {
  AiErrorCode,
  AiStatus,
  DirectorOutput,
  DirectorRequest,
  HooksRequest,
  ImageRequest,
  MediaResponse,
  ScriptOutput,
  ScriptRequest,
  VoiceRequest,
  VoiceResponse,
} from "@/lib/ai/contracts";
import type { Hook } from "@/lib/project/schema";

/* Browser-side calls to /api/ai/*. The API key never leaves the server. */

export class AiRequestError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AiRequestError("network", "Couldn’t reach the Bamio server. Check it is running, then try again.");
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as { error?: { code?: AiErrorCode; message?: string } } | null)?.error;
    throw new AiRequestError(error?.code ?? "upstream", error?.message ?? `The request failed (${res.status}). Try again.`);
  }
  return data as T;
}

export const aiClient = {
  async status(): Promise<AiStatus> {
    const res = await fetch("/api/ai/status", { cache: "no-store" });
    if (!res.ok) throw new AiRequestError("upstream", "Couldn’t check the AI status.");
    return (await res.json()) as AiStatus;
  },
  hooks: (req: HooksRequest, signal?: AbortSignal) => post<{ hooks: Hook[] }>("/api/ai/hooks", req, signal),
  script: (req: ScriptRequest, signal?: AbortSignal) => post<ScriptOutput>("/api/ai/script", req, signal),
  image: (req: ImageRequest, signal?: AbortSignal) => post<MediaResponse>("/api/ai/image", req, signal),
  voice: (req: VoiceRequest, signal?: AbortSignal) => post<VoiceResponse>("/api/ai/voice", req, signal),
  director: (req: DirectorRequest, signal?: AbortSignal) => post<DirectorOutput>("/api/ai/director", req, signal),
};

export function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function errorMessage(err: unknown): string {
  if (err instanceof AiRequestError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}

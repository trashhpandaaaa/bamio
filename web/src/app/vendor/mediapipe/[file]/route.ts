import { readFile } from "node:fs/promises";
import path from "node:path";

/*
 * The face detector's WebAssembly (MediaPipe, Apache 2.0), served by Bamio from the installed
 * package, so the editor's auto-reframe never asks another site for code. Only these files.
 */
const FILES: Record<string, string> = {
  "vision_wasm_internal.js": "text/javascript",
  "vision_wasm_internal.wasm": "application/wasm",
  "vision_wasm_nosimd_internal.js": "text/javascript",
  "vision_wasm_nosimd_internal.wasm": "application/wasm",
};

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const type = FILES[file];
  if (!type) return new Response("Not found", { status: 404 });
  const body = await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "@mediapipe", "tasks-vision", "wasm", file));
  return new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
}

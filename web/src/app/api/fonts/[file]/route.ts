import { captionFontCss, ensureFont, fontByFile } from "@/lib/server/caption-fonts";
import { serveFile } from "@/lib/server/files";
import { HttpError, userRoute } from "@/lib/server/http";

type Params = { file: string };

/**
 * Caption fonts for the editor preview, the same files the export burns in:
 * captions.css?lang=xx declares them, and each font file is served (downloaded the first
 * time it's needed). Only files listed in caption-fonts.json are served.
 */
export const GET = userRoute<Params>(async (req, { params }) => {
  if (params.file === "captions.css") {
    const lang = new URL(req.url).searchParams.get("lang") ?? undefined;
    return new Response(captionFontCss(lang), { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "private, max-age=86400" } });
  }
  const font = fontByFile(params.file);
  if (!font) throw new HttpError(404, "not_found", "No such font.");
  const file = await ensureFont(font);
  return serveFile(req, file, { type: font.file.endsWith(".otf") ? "font/otf" : "font/ttf", maxAge: 31_536_000 });
});

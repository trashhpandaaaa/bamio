import "server-only";

/*
 * What kind of picture some bytes are, read from the bytes themselves: a browser's
 * content-type is whatever the person sending it chose to say, and these files are stored and
 * served again. Used for a campaign's audience proof and for a brand kit's logo.
 */

export type ImageKind = { ext: "png" | "jpg" | "webp"; type: string };

export function imageKind(bytes: Uint8Array): ImageKind | null {
  const starts = (...b: number[]) => b.every((v, i) => bytes[i] === v);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { ext: "png", type: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { ext: "jpg", type: "image/jpeg" };
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { ext: "webp", type: "image/webp" };
  return null;
}

/** The media type to serve a stored picture with, from the extension its key ends in. */
export const imageType = (ext: string | undefined): string => (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");

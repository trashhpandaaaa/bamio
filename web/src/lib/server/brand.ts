import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { brandKitSchema, brandLookSchema, EMPTY_KIT, type BrandKit, type BrandLook } from "@/lib/clips/brand";
import type { ClipEdit } from "@/lib/clips/schema";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { imageKind } from "@/lib/server/image-kind";
import { storage } from "@/lib/server/storage";
import { brandKeys, workRoot } from "@/lib/server/store";

/*
 * Reading and writing an account's brand kit (lib/clips/brand.ts holds its shape and the
 * arithmetic, shared with the browser).
 *
 * The logo's bytes go to storage under the account's own prefix (brandKeys), so deleting the
 * account deletes them. Nothing here is per project.
 */

export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export { brandLookSchema, type BrandKit, type BrandLook };

export async function readBrandKit(userId: string): Promise<BrandKit> {
  const [row] = await db()<{ data: unknown }[]>`select data from brand_kits where user_id = ${userId}`;
  if (!row) return EMPTY_KIT;
  const parsed = brandKitSchema.safeParse(row.data);
  if (!parsed.success) {
    console.error(`[bamio/brand] the brand kit of ${userId} failed validation`, parsed.error.issues.slice(0, 3));
    return EMPTY_KIT;
  }
  return parsed.data;
}

async function write(userId: string, change: (kit: BrandKit) => BrandKit): Promise<BrandKit> {
  return db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`brand:${userId}`}))`;
    const [row] = await tx<{ data: unknown }[]>`select data from brand_kits where user_id = ${userId}`;
    const parsed = row ? brandKitSchema.safeParse(row.data) : null;
    const current = parsed?.success ? parsed.data : EMPTY_KIT;
    const next = brandKitSchema.parse({ ...change(current), updatedAt: Date.now() });
    await tx`insert into brand_kits (user_id, data, updated_at) values (${userId}, ${tx.json(JSON.parse(JSON.stringify(next)))}, ${next.updatedAt})
             on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at`;
    return next;
  }) as Promise<BrandKit>;
}

export const saveBrandLook = (userId: string, look: BrandLook) => write(userId, (kit) => ({ ...kit, look: brandLookSchema.parse(look) }));

/** Replace the logo. The kind is read from the bytes, never from what the browser said it sent. */
export async function saveBrandLogo(userId: string, bytes: Uint8Array): Promise<BrandKit> {
  if (bytes.byteLength > BRAND_LOGO_MAX_BYTES) throw new HttpError(413, "too_large", `A logo can be up to ${BRAND_LOGO_MAX_BYTES / 1024 / 1024} MB.`);
  const kind = imageKind(bytes);
  if (!kind) throw new HttpError(400, "not_image", "A logo must be a PNG, JPEG or WebP picture. PNG keeps a transparent background.");
  const current = await readBrandKit(userId);
  // Storage takes a file, so the bytes land in scratch first and `publish` moves them on.
  const file = path.join(/*turbopackIgnore: true*/ workRoot(), "brand", `${randomUUID()}.${kind.ext}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  await storage().publish(brandKeys(userId).logo(kind.ext), file, kind.type);
  // A logo saved in another format before would otherwise sit there unused.
  if (current.logo && current.logo.ext !== kind.ext) await storage().remove(brandKeys(userId).logo(current.logo.ext)).catch(() => undefined);
  return write(userId, (kit) => ({ ...kit, logo: { ext: kind.ext, bytes: bytes.byteLength, at: Date.now() } }));
}

export async function removeBrandLogo(userId: string): Promise<BrandKit> {
  const current = await readBrandKit(userId);
  if (current.logo) await storage().remove(brandKeys(userId).logo(current.logo.ext)).catch(() => undefined);
  return write(userId, ({ logo: _gone, ...kit }) => kit);
}

/** The stored logo's key, or null when there is none. */
export async function brandLogoKey(userId: string): Promise<string | null> {
  const kit = await readBrandKit(userId);
  return kit.logo ? brandKeys(userId).logo(kit.logo.ext) : null;
}

/**
 * The look a new project's clips start with: the account's brand kit **under** whatever the
 * import form asked for, so a choice made for this one video still wins. In practice the kit
 * contributes the caption look and the logo, which the form has no controls for; the clip
 * editor's "Use my brand kit" applies the whole thing (withBrand) when someone asks.
 */
export async function brandDefaults(userId: string, asked: Partial<ClipEdit> | undefined): Promise<Partial<ClipEdit>> {
  const kit = await readBrandKit(userId).catch(() => EMPTY_KIT);
  const { look, ...rest } = kit.look;
  return { ...rest, ...(look ? { look } : {}), ...(asked ?? {}) };
}

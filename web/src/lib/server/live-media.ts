import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parsePlaylistWindow } from "@/lib/server/hls";
import { HttpError } from "@/lib/server/http";
import { LIVE_PLAYLIST, livePlaylistSnapshot } from "@/lib/server/live";
import { putText, storage } from "@/lib/server/storage";
import { mediaKeys, scratch } from "@/lib/server/store";

/*
 * A followed stream's HLS (source.m3u8, init.mp4, seg-NNNNNN.m4s) while it grows. ffmpeg
 * writes it on the machine following the stream: with local storage straight into storage
 * (the project's live/ folder), with object storage into a scratch folder that syncLive()
 * copies up every few seconds, so the player and other machines find it there.
 */

/** Where the capture writes its HLS. */
export function liveDir(userId: string, projectId: string): string {
  const s = storage();
  return s.localPath ? s.localPath(mediaKeys(userId, projectId).live) : scratch(projectId).live;
}

const SEGMENT = /^seg-\d{6}\.m4s$/;
/** Segments already copied up, per project (after a restart they're copied again: harmless). */
const synced: Map<string, Set<string>> = ((globalThis as { __bamioLiveSynced?: Map<string, Set<string>> }).__bamioLiveSynced ??= new Map());

/**
 * With object storage: copy the capture's finished files up (each once), then the playlist,
 * which only lists finished segments (ffmpeg writes them under a temporary name first).
 * Nothing to do with local storage.
 */
export async function syncLive(userId: string, projectId: string): Promise<void> {
  const s = storage();
  if (s.localPath) return;
  const dir = scratch(projectId).live;
  const keys = mediaKeys(userId, projectId);
  const playlist = await readFile(path.join(dir, LIVE_PLAYLIST), "utf8").catch(() => null);
  if (!playlist) return;
  const done = synced.get(projectId) ?? new Set<string>();
  synced.set(projectId, done);
  const names = ["init.mp4", ...playlist.split(/\r?\n/).map((l) => l.trim()).filter((l) => SEGMENT.test(l))];
  for (const name of names) {
    if (done.has(name) || !existsSync(path.join(dir, name))) continue;
    await s.publish(`${keys.live}/${name}`, path.join(dir, name), "video/mp4", { keep: true });
    done.add(name);
  }
  await putText(`${keys.live}/${LIVE_PLAYLIST}`, playlist, "application/vnd.apple.mpegurl");
}

/** The playlist as it is now: from the capture's own folder on this machine, else from storage. */
async function playlistText(userId: string, projectId: string): Promise<{ text: string; local: string | null }> {
  const local = liveDir(userId, projectId);
  const here = await readFile(path.join(local, LIVE_PLAYLIST), "utf8").catch(() => null);
  if (here !== null) return { text: here, local };
  return { text: (await storage().readText(`${mediaKeys(userId, projectId).live}/${LIVE_PLAYLIST}`)) ?? "", local: null };
}

/** Seconds of video captured so far. */
export async function liveCaptured(userId: string, projectId: string): Promise<number> {
  const { text } = await playlistText(userId, projectId);
  return text ? parsePlaylistWindow(text).windowSec : 0;
}

/**
 * A copy of the playlist as it is now, closed with ENDLIST, for ffmpeg to read like a finished
 * video. On the machine capturing it, next to its segments; elsewhere, with every file as a
 * signed link (ffmpeg is allowed to open those for snapshots: see bin.ts). Remove it with `done`.
 */
export async function liveSnapshot(userId: string, projectId: string): Promise<{ file: string; durationSec: number; done: () => Promise<void> }> {
  const { text, local } = await playlistText(userId, projectId);
  if (local) return livePlaylistSnapshot(local);
  if (!text.includes("#EXTINF")) throw new HttpError(409, "no_video_yet", "No video has been captured yet.");
  const keys = mediaKeys(userId, projectId);
  const link = (name: string) => storage().readable(`${keys.live}/${name}`);
  const lines = await Promise.all(
    text.split(/\r?\n/).map(async (line) => {
      const t = line.trim();
      if (SEGMENT.test(t)) return link(t);
      const map = /^(#EXT-X-MAP:URI=")([^"]+)(".*)$/.exec(t);
      return map ? `${map[1]}${await link(map[2]!)}${map[3]}` : line;
    }),
  );
  const body = lines.join("\n");
  const dir = scratch(projectId).dir;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `snap-${randomUUID()}.m3u8`).split(path.sep).join("/");
  await writeFile(file, body.includes("#EXT-X-ENDLIST") ? body : `${body.trimEnd()}\n#EXT-X-ENDLIST\n`, "utf8");
  return { file, durationSec: parsePlaylistWindow(text).windowSec, done: () => rm(file, { force: true }) };
}

/** The followed stream's HLS is no longer needed (it became source.mp4, or the follow failed). */
export async function clearLive(userId: string, projectId: string) {
  synced.delete(projectId);
  await storage().removePrefix(mediaKeys(userId, projectId).live);
  await rm(scratch(projectId).live, { recursive: true, force: true });
}

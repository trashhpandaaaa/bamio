import { createFromUrlSchema, LIMITS } from "@/lib/clips/schema";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { assertDiskSpace, plannedStages, startImport } from "@/lib/server/jobs";
import { inspectCached } from "@/lib/server/media";
import { blankProject, createProject, listProjects } from "@/lib/server/store";

export const GET = userRoute(async (_req, { userId }) => Response.json(await listProjects(userId)));

/** Import from a link: YouTube, Twitch, Kick and most other video sites. */
export const POST = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, createFromUrlSchema);
    const info = await inspectCached(input.url);

    let range = input.range;
    if (range) {
      if (range.start >= info.durationSec) throw new HttpError(400, "bad_range", "The part starts after the video ends.");
      range = { start: range.start, end: Math.min(range.end, info.durationSec) };
      const length = range.end - range.start;
      if (length < LIMITS.minClipSec) throw new HttpError(400, "bad_range", "Choose a part at least 3 seconds long.");
      if (length > LIMITS.maxMediaSec) throw new HttpError(400, "bad_range", "Choose a part up to 3 hours long.");
      // The whole video was selected: download it normally.
      if (range.start <= 0.5 && range.end >= info.durationSec - 0.5) range = undefined;
    } else if (info.durationSec > LIMITS.maxMediaSec) {
      throw new HttpError(400, "too_long", "This video is longer than 3 hours. Choose a part of it to import.");
    }
    const durationSec = range ? range.end - range.start : info.durationSec;
    // Rough size of a 1080p download plus the prepared copy.
    await assertDiskSpace(durationSec * 1.2 * 1024 * 1024);

    const draft = blankProject({
      title: info.title,
      source: { kind: "url", url: info.url, platform: info.platform, title: info.title, uploader: info.uploader, durationSec, range },
      findClips: input.findClips,
      clipLength: input.clipLength,
      language: input.language,
      edit: input.edit,
      job: { status: "queued", message: "Waiting to start" },
    });
    const project = { ...draft, job: { ...draft.job, stages: plannedStages(draft) } };
    await createProject(userId, project);
    startImport(userId, project.id);
    return Response.json(project, { status: 201 });
  },
  { rate: { bucket: "create", limit: 15, windowMs: 10 * 60_000 } },
);

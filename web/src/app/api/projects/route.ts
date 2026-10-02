import { createFromUrlSchema, LIMITS } from "@/lib/clips/schema";
import { assertCanProcess, projectLimit } from "@/lib/server/billing";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { assertDiskSpace, plannedStages, startFollow, startImport } from "@/lib/server/jobs";
import { liveCaptureProblem } from "@/lib/clips/live";
import { followStart, inspectLink, liveInfo } from "@/lib/server/live";
import { blankProject, createProject, listProjects } from "@/lib/server/store";

export const GET = userRoute(async (_req, { userId }) => Response.json(await listProjects(userId)));

/** Import from a link: YouTube, Twitch, Kick and most other video sites. */
export const POST = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, createFromUrlSchema);
    // A plan with minutes left (with billing on), before spending time on the link.
    await assertCanProcess(userId);
    const info = await inspectLink(input.url);

    if (info.live) {
      if (!input.live) throw new HttpError(400, "live_options", "This stream is live. Choose how much of it to capture.");
      // Fresh details: a Twitch VOD keeps growing, and the capture is measured from now.
      const live = await liveInfo(info.url, info.platform);
      const follow = input.live.follow ? followStart(live, info.live.startedAt) : undefined;
      if (follow) {
        // Room for the history and an hour more at about 6 Mbit/s (1080p60); it keeps growing.
        await assertDiskSpace((follow.backSec + 3600) * 0.75 * 1024 * 1024);
      } else {
        const problem = liveCaptureProblem(input.live.rewindSec, input.live.recordSec, live);
        if (problem) throw new HttpError(400, "bad_capture", problem);
        await assertCanProcess(userId, { sec: input.live.rewindSec + input.live.recordSec, source: "capture" });
      }
      const draft = blankProject({
        title: info.title,
        source: {
          kind: "url",
          url: info.url,
          platform: info.platform,
          title: info.title,
          uploader: info.uploader,
          durationSec: follow ? 0 : input.live.rewindSec + input.live.recordSec,
          live: {
            rewindSec: follow ? follow.backSec : input.live.rewindSec,
            recordSec: follow ? 0 : input.live.recordSec,
            requestedAt: Date.now(),
            vodUrl: live.vod?.url,
            vodDurationSec: live.vod?.durationSec,
            follow: follow ? { status: "following", backSec: follow.backSec, fromStart: follow.fromStart } : undefined,
          },
        },
        findClips: input.findClips,
        clipLength: input.clipLength,
        language: input.language,
        edit: input.edit,
        job: { status: "queued", message: "Waiting to start" },
      });
      // Following: connecting is the only step; captions and clips come while it grows.
      const project = { ...draft, job: { ...draft.job, stages: follow ? (["recording"] as const).slice() : plannedStages(draft) } };
      await createProject(userId, project, await projectLimit(userId));
      // A capture's moment has passed by the time a retry would run: no retries.
      if (follow) await startFollow(userId, project.id);
      else await startImport(userId, project.id, { retries: false });
      return Response.json(project, { status: 201 });
    }

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
    await assertCanProcess(userId, { sec: durationSec, source: "link" });
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
    await createProject(userId, project, await projectLimit(userId));
    await startImport(userId, project.id);
    return Response.json(project, { status: 201 });
  },
  { rate: { bucket: "create", limit: 15, windowMs: 10 * 60_000 } },
);

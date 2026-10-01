# Bamio

Bamio is a clipping and editing tool: it turns long videos (YouTube, Twitch, Kick, other sites, uploads) into vertical shorts with AI-picked moments and word-by-word captions. Design phases A and B are done; the product is a Next.js app in `web/` with Clerk sign-in, on-device transcription in any language (sherpa-onnx: Parakeet, Omnilingual ASR, Whisper tiny for language detection, Silero VAD), Google Gemini (clip finding), yt-dlp (link import) and ffmpeg (processing, export).

## Start of every session

1. Read `DESIGN_STATUS.md`. It says what is done, what was decided, and what to do next.
2. For design work, read `DESIGN_TOOLS.md` (installed skills and which one wins when they disagree).
3. For app work, read `web/README.md` and `web/AGENTS.md`. Next.js 16 differs from older versions: read the bundled docs in `web/node_modules/next/dist/docs/` before using an API.

## App (`web/`)

- Run: `cd web && npm run dev`. `npm run setup:media` once (yt-dlp and the speech models). Without a Gemini key, set `BAMIO_AI_MOCK=1` for fake AI answers (English transcription still runs for real on the device).
- Verify before calling work done: `npm run check` (typecheck, lint, unit tests), `npm run build`, and `npm run test:e2e` (Playwright on installed Edge, mock AI). All must pass. After UI changes also run `E2E_RESPONSIVE=1 npx playwright test responsive` (every screen at 320 to 1440 wide: no sideways scroll, nothing past the edge, tap targets of 24px or more).
- The design system lives in `web/src/styles/tokens.css` and `components.css` (copied from `design/system/`; keep them in sync). Never hard-code a color, size or radius that has a token.
- The Gemini key stays server-side: only `src/lib/ai/server/*` (marked `server-only`) may read it.
- Every Gemini response is validated with zod (see `src/lib/ai/server/clips-ai.ts`). Shared schemas live in `src/lib/clips/schema.ts`.
- Server-only code (`src/lib/server/*`, marked `server-only`) runs the media tools and the disk store. Every API route goes through `userRoute` (signed-in user, cross-site check, rate limit), except Stripe's webhook (`/api/billing/webhook`), which has no session and must verify the signature over the raw body first. Never build a file path from user input without the id checks in `store.ts`.
- Plans and payments (Stripe): the catalog is `src/lib/billing/plans.ts` (prices, minutes, projects, priority; features Bamio doesn't have yet are `soon: true` and show as coming soon: never list an unbuilt feature as included). Only `src/lib/server/billing.ts` reads `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. Without the key billing is off and nothing may be limited. New AI work goes through its gates: `assertCanProcess` before an import or capture, `recordUsage` once per import (keyed, so retries count once), `assertPlan` for AI on an existing video, `queuePriority` for queue order. After changing prices, run `npm run stripe:setup`; test gates with `E2E_BILLING=1` (see web/README.md).
- The caption preview (`clip-preview.tsx`) and the export (`src/lib/clips/ass.ts`) share sizes and margins. Change them together. Other scripts use Noto fonts chosen per character from `src/lib/server/caption-fonts.json` (coverage, libass name, height; generated from the font files with fontTools) in both the export (`assMarkup`) and the preview (`/api/fonts/captions.css`). Transcript text has a space between every word; `joinWords`/`wordGap` leave it out between words of scripts written without spaces. libass here can't wrap such text, and needs `shaping=complex` for Indic scripts.
- Transcripts in every language, with a time for every word, come from `web/workers/transcribe.mjs` (sherpa-onnx in a child process; Whisper tiny detects the language unless it was picked; Parakeet 0.6B v2 for English, v3 for 24 European languages, Omnilingual ASR 1B for the rest; `engineFor` / `engineForWindows` in `transcribe-core.mjs` decide). Omnilingual transcripts are repaired where speakers switch to English (`repairMultilingual`: English checked against the English model, stretches in the wrong script decoded again with the video's own speech as context); test changes on real code-mixed audio (e.g. a Nepali podcast), not only single-language clips. Bump `TRANSCRIBER_VERSION` in `schema.ts` when a change is worth re-transcribing for (`retranscribeReason` offers it). Pure logic (word splitting in scripts without spaces, Indian script repair, script and English agreement checks) is in `transcribe-core.mjs`, model downloads in `speech-models.mjs` with pinned SHA-256. Don't go back to Gemini for timing: on long audio its timestamps drift by minutes (see DESIGN_STATUS.md). The native addon loads relative to the working folder: run scripts that use it from `web/`.
- Any runtime path under `process.cwd()` in server code needs `/*turbopackIgnore: true*/` on every `path.join` / `path.resolve` call, or `next build` traces that folder (it once tried to read a 1.4 GB video from `web/.data`).
- `next.config.ts` also excludes `.data`, `.models`, `.bin` and `qa` from output tracing (`outputFileTracingExcludes`), which covers webpack builds too. If Windows Smart App Control blocks `next-swc.win32-x64-msvc.node` ("An Application Control policy has blocked this file"; it happened once, briefly), Turbopack can't run: build with `npx next build --webpack` until it loads again.
- Live streams are captured by `src/lib/server/live.ts` (Twitch: its in-progress VOD via `yt-dlp --live-from-start`; others: ffmpeg records the live HLS playlist, going back as far as the playlist's history allows, stoppable with "q"; playlist helpers in `hls.ts`). "Follow the stream" (`followLive`, and `followProject` in `jobs.ts`) writes a growing HLS into the project's `live/` folder while the project is edited: anything that reads the video must go through `withSourceFile` (a closed snapshot of the playlist, with forward slashes: ffprobe 4 can't find the segments otherwise), and it becomes source.mp4 when it ends. Capture rules shared with the UI are in `src/lib/clips/live.ts`. Test with `npx playwright test live-stream` and E2E_LIVE_TWITCH / E2E_LIVE_YOUTUBE / E2E_LIVE_KICK set to channels that are live.
- Speed: a part of a video is fetched by its fragment index where the files have one (`src/lib/server/dash.ts`), else the whole file is downloaded and cut when quicker (`downloadUrl` in `media.ts`); never re-encode to cut a part. Transcription decodes several speech parts at once (`speechCpu`). `E2E_PERF=1 npx playwright test perf` times an import step by step.
- Processing needs a long-running Node server (not serverless). Projects are stored in `web/.data/` (gitignored).

## Design comps (`design/`)

- Static HTML comps. Serve over HTTP for Playwright QA (`file://` is blocked), and run `playwright-cli` from the project root:
  `python -m http.server 5178 --bind 127.0.0.1 --directory design`
- `references/awesome-design-md/` is a study library. Borrow reasoning, never copy tokens or layouts.

## Working rules

- After each phase or major change, update `DESIGN_STATUS.md` (what was done, decisions, open questions, next task).
- The Next dev server allows one instance per project; the e2e suite reuses a running one on port 3100. If a dev server is already running elsewhere, use `npm run build` then `BAMIO_AI_MOCK=1 npx next start -p 3100` and run `npm run test:e2e`.

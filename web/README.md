# Bamio web app

Bamio turns long videos into vertical shorts. Paste a YouTube, Twitch or Kick link (or any site yt-dlp supports), or upload a file. Bamio transcribes it, finds the moments that work as standalone clips, and lets you trim, reframe (9:16, 1:1, 16:9), caption word by word and export 1080p MP4s.

Built with Next.js 16 (App Router), React 19, TypeScript, Clerk (sign-in), on-device speech recognition (NVIDIA Parakeet and Silero VAD via sherpa-onnx) for English transcripts with word timing, Google Gemini (clip finding, and transcripts in other languages), yt-dlp (link import) and ffmpeg (processing and export). The visual design comes from `../design/` (direction: Hook).

## Quick start

```sh
cd web
npm install
npm run setup:media     # yt-dlp into web/.bin and the speech models into web/.models (~110 MB), all checksum verified
npm run ai:check        # confirms the Gemini key and models work
npm run dev             # http://localhost:3000
```

`web/.env` needs the Clerk keys (written by `clerk init`) and `GEMINI_API_KEY` (get one at https://aistudio.google.com/apikey). See `.env.example` for every option.

**No Gemini key?** Uploading, clipping by hand, editing and exporting all work without AI; captions and AI clip finding are switched off and the app says so. For demos and tests, `BAMIO_AI_MOCK=1` gives deterministic fake AI answers:

```sh
# PowerShell
$env:BAMIO_AI_MOCK="1"; npm run dev
# bash
BAMIO_AI_MOCK=1 npm run dev
```

## Configuration (`web/.env`)

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | none | Transcription and clip finding. Stays on the server. |
| `BAMIO_TEXT_MODEL` | `gemini-3.8-flash` | Used for both transcription (audio in) and clip finding (JSON out). |
| `BAMIO_TEXT_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Tried once when the main model is busy, rate limited or missing. `none` turns it off. |
| `BAMIO_AI_MOCK` | off | `1` = fake AI, for demos and end-to-end tests. |
| `BAMIO_DATA_DIR` | `web/.data` | Where projects, transcripts and exports are stored. |
| `BAMIO_MODELS_DIR` | `web/.models` | Where the speech models are kept. |
| `BAMIO_LOCAL_TRANSCRIBE` | on | `0` sends English to Gemini too (not recommended: timing is far less accurate). |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH` | bundled | Use your own builds of the media tools. |

## How it works

1. **Import** (`/new`): paste a link (Bamio shows the title, channel and length as you paste) or drop a file. Choose part of a long video, whether to find clips with AI, clip length, format and caption style.
2. **Processing** runs on the server and continues if you leave the page: download or upload, prepare a browser-playable MP4, transcribe (English on this device, with a time for every word; other languages with Gemini), then find clips with Gemini. Progress shows as steps.
3. **Project** (`/projects/[id]`): watch the source, see AI clips with a score and the reason they were picked, or mark your own with I and O. Export or download each clip.
4. **Clip editor** (`/projects/[id]/clips/[clipId]`): trim on a filmstrip, pick the format, drag the picture to reframe (or fit it over a blurred fill), choose caption style and position, fix caption words, add a title. Changes save automatically. Export renders on the server and the preview matches the file.

Keyboard: Space plays and pauses, I and O set the start and end at the playhead, arrow keys move trim handles (Shift for 1 second steps).

## Architecture

```
src/
  app/
    page.tsx                         landing
    new/                             import (link or upload)
    projects/                        project list
    projects/[id]/                   source player, mark in / out, clip list
    projects/[id]/clips/[clipId]/    clip editor (preview, trim bar, inspector)
    profile/                         Clerk profile + clip defaults
    api/
      system/status                  what this server can do (yt-dlp, ffmpeg, AI)
      sources/inspect                look up a link before importing
      projects, projects/upload      list, import from link, start an upload
      projects/[id]/...              project, upload chunks, retry, source (Range), thumb / frames,
                                     transcript, find-clips, clips, clip export and download
  lib/
    clips/                           shared by browser and server: schemas (zod), time and caption
                                     maths, crop maths, ASS captions, ffmpeg arguments, URL checks, API client
    server/                          server only: auth and HTTP helpers, disk store, media tools
                                     (yt-dlp, ffprobe, ffmpeg), background jobs, file streaming
    ai/server/                       Gemini client (retries, fallback model), transcription and clip finding
workers/transcribe.mjs               on-device transcription (sherpa-onnx: Silero VAD + Parakeet TDT), run as a child process
workers/transcribe-core.mjs          its pure logic (tokens to timed words, words to caption phrases), unit tested
workers/speech-models.mjs            downloads and checks the speech models
  hooks/use-project.ts               polling while the server is busy
assets/fonts/                        Bricolage Grotesque ExtraBold, burned into captions (OFL)
scripts/                             setup-media.mjs (yt-dlp), check-ai.mjs
```

Key decisions:

- **Processing runs in the Next.js server process** with a small in-memory queue; job state is saved in each project's JSON, so the browser polls it. A restart marks unfinished work as failed with a Try again button. This needs a long-running Node server (a VPS or container), **not serverless hosting**.
- **Storage is the server's disk**, one folder per Clerk user and project. Ids are validated so no path can leave the data folder; every route checks the signed-in user.
- **Uploads go in 8 MB chunks**, because Next.js buffers request bodies that pass through `proxy.ts` (10 MB). Chunks are resumable.
- **Model output is untrusted.** Every Gemini answer is validated with zod and cleaned (times clamped and ordered, clips snapped to phrase edges, overlaps removed).
- **English is transcribed on the device.** Gemini's audio timestamps drift badly on long audio (minutes off after 20 minutes of a podcast in our tests, with whole minutes of speech left out) and the free tier allows few requests a day. `workers/transcribe.mjs` runs Silero VAD and NVIDIA Parakeet TDT 110M (CC-BY-4.0) through sherpa-onnx in its own Node process; every word gets its time from the audio. On a 2.4-hour podcast: 22x real time on a laptop CPU (6.5 minutes) and 97% of words within 0.25 s of YouTube's own timings (median 0.07 s), steady from start to end. Gemini is then used once per video, to pick clips. Other languages are still transcribed by Gemini (5-minute chunks) with approximate timing. Older projects have a "Transcribe again" button, which also moves AI clips to where their words are actually spoken (`src/lib/clips/relocate.ts`).
- **Preview matches export.** The editor draws captions with the same sizes, outlines and margins as the ASS file ffmpeg burns in, with the same font.
- **Links are checked** before yt-dlp sees them: http(s) only, and hosts that resolve to private or loopback addresses are refused.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run check` | Typecheck (with route types) + lint + unit tests |
| `npm test` | Unit tests (Vitest): time and caption maths, timed words and phrases, crop, clip clean-up, ASS output, ffmpeg arguments, URL safety, byte ranges, store (locking, restarts), HTTP helpers, AI helpers |
| `npm run test:e2e` | End-to-end tests (Playwright on installed Microsoft Edge, mock AI). Reuses a server on port 3100 or starts `next dev` there. Makes a test video with ffmpeg and a committed speech track, uploads it, transcribes it on the device, finds clips (mock AI), edits, exports and checks the MP4 with ffprobe. |
| `npm run setup:media` | Downloads or updates yt-dlp (re-run when a site stops working) and the speech models |
| `npm run ai:check` | Checks the Gemini key, JSON output and audio input on the main and fallback models |

Opt-in tests: `E2E_LIVE=1` imports part of a real YouTube video; `E2E_LIVE_AI=1 E2E_PORT=<port>` runs real Gemini transcription against a server started without mock AI; `E2E_SCREENSHOTS=1` saves screenshots to `qa/screens/`.

Tip: Next.js allows one `next dev` per project. If one is already running on port 3000, run the tests against a production build instead: `npm run build`, then `BAMIO_AI_MOCK=1 npx next start -p 3100`, then `npm run test:e2e`.

## Limitations

- **Only import videos you own or have permission to use.** Some sites block downloads, need a sign-in, or limit by region; Bamio explains what went wrong, and uploading the file always works.
- **Live streams** can be clipped once the replay (VOD) is available.
- **Limits:** 3 hours per video (import part of a longer one), 4 GB per upload, 60 clips per project, 100 projects per user, clips from 3 seconds to 3 minutes.
- **Transcription needs CPU:** about 1 minute per 20 minutes of video on a laptop. The speech models (about 110 MB) download with `npm run setup:media`, or on first use.
- **On-device transcription is English only.** Other languages go to Gemini (needs a key), whose caption timing is approximate.
- **One server process.** The queue and rate limits live in memory, so run one instance (or add a shared queue before scaling out).

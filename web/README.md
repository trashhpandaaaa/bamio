# Bamio web app

Bamio turns long videos into vertical shorts. Paste a YouTube, Twitch or Kick link (or any site yt-dlp supports), or upload a file. Bamio transcribes it, finds the moments that work as standalone clips, and lets you trim, reframe (9:16, 1:1, 16:9), caption word by word and export 1080p MP4s.

Built with Next.js 16 (App Router), React 19, TypeScript, Clerk (sign-in), on-device speech recognition in any language with word timing (via sherpa-onnx: NVIDIA Parakeet, Meta Omnilingual ASR, Whisper for detecting the language, Silero VAD), Google Gemini (clip finding), yt-dlp (link import) and ffmpeg (processing and export). The visual design comes from `../design/` (direction: Hook).

## Quick start

```sh
cd web
npm install
npm run setup:media     # yt-dlp into web/.bin, speech models and caption fonts into web/.models (~1.9 GB), all checksum verified
npm run ai:check        # confirms the Gemini key and models work
npm run dev             # http://localhost:3000
```

`web/.env` needs the Clerk keys (written by `clerk init`) and `GEMINI_API_KEY` (get one at https://aistudio.google.com/apikey). See `.env.example` for every option.

**No Gemini key?** Uploading, transcription and captions, clipping by hand, editing and exporting all work without it; only AI clip finding is switched off, and the app says so. For demos and tests, `BAMIO_AI_MOCK=1` gives deterministic fake AI answers:

```sh
# PowerShell
$env:BAMIO_AI_MOCK="1"; npm run dev
# bash
BAMIO_AI_MOCK=1 npm run dev
```

## Configuration (`web/.env`)

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | none | Clip finding. Stays on the server. |
| `BAMIO_TEXT_MODEL` | `gemini-3.8-flash` | Used for clip finding (and for transcription with `BAMIO_LOCAL_TRANSCRIBE=0`). |
| `BAMIO_TEXT_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Tried once when the main model is busy, rate limited or missing. `none` turns it off. |
| `BAMIO_AI_MOCK` | off | `1` = fake AI, for demos and end-to-end tests. |
| `BAMIO_DATA_DIR` | `web/.data` | Where projects, transcripts and exports are stored. |
| `BAMIO_MODELS_DIR` | `web/.models` | Where the speech models and caption fonts are kept. |
| `BAMIO_LOCAL_TRANSCRIBE` | on | `0` transcribes with Gemini instead (not recommended: timing is far less accurate). |
| `BAMIO_SPEECH_MODEL` | `accurate` | `fast` uses smaller models: English Parakeet 110M, other languages Omnilingual 300M. About twice as fast, a few percent less accurate. |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH` | bundled | Use your own builds of the media tools. |

## How it works

1. **Import** (`/new`): paste a link (Bamio shows the title, channel and length as you paste) or drop a file. Choose part of a long video, the spoken language (detected automatically unless you pick one), whether to find clips with AI, clip length, format and caption style. For a live stream, choose how far back to start (Twitch, and YouTube streams with rewind) and how long to keep recording; you can stop early from the project page.
2. **Processing** runs on the server and continues if you leave the page: download or upload, prepare a browser-playable MP4, transcribe on this device (any language, with a time for every word), then find clips with Gemini. Progress shows as steps.
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
      fonts/[file]                   caption fonts for the preview (the export's files) and their CSS
  lib/
    clips/                           shared by browser and server: schemas (zod), time and caption
                                     maths, crop maths, ASS captions, ffmpeg arguments, URL checks, API client
    server/                          server only: auth and HTTP helpers, disk store, media tools
                                     (yt-dlp, ffprobe, ffmpeg), background jobs, file streaming,
                                     caption fonts per script (caption-fonts.ts + .json)
    ai/server/                       Gemini client (retries, fallback model), transcription and clip finding
workers/transcribe.mjs               on-device transcription in any language (sherpa-onnx: Whisper tiny detects the language,
                                     Silero VAD finds speech, Parakeet or Omnilingual transcribes), run as a child process
workers/transcribe-core.mjs          its pure logic (tokens to timed words in any script, caption phrases, which model
                                     for which language, Indian script repair), unit tested
workers/speech-models.mjs            downloads and checks the speech models
  hooks/use-project.ts               polling while the server is busy
assets/fonts/                        Bricolage Grotesque ExtraBold, burned into captions (OFL); Noto fonts for
                                     other scripts are downloaded into web/.models/fonts
scripts/                             setup-media.mjs (yt-dlp, models, fonts), check-ai.mjs
```

Key decisions:

- **Processing runs in the Next.js server process** with a small in-memory queue; job state is saved in each project's JSON, so the browser polls it. A restart marks unfinished work as failed with a Try again button. This needs a long-running Node server (a VPS or container), **not serverless hosting**.
- **Storage is the server's disk**, one folder per Clerk user and project. Ids are validated so no path can leave the data folder; every route checks the signed-in user.
- **Uploads go in 8 MB chunks**, because Next.js buffers request bodies that pass through `proxy.ts` (10 MB). Chunks are resumable.
- **Model output is untrusted.** Every Gemini answer is validated with zod and cleaned (times clamped and ordered, clips snapped to phrase edges, overlaps removed).
- **Every language is transcribed on the device.** Gemini's audio timestamps drift badly on long audio (minutes off after 20 minutes of a podcast in our tests, with whole minutes of speech left out) and the free tier allows few requests a day, so Gemini is only used once per video, to pick clips. `workers/transcribe.mjs` runs in its own Node process:
  - **Which language:** the one picked at import, or Whisper tiny (MIT, by OpenAI) listening to speech at three points of the video (right on all 12 languages tested).
  - **English:** NVIDIA Parakeet TDT 0.6B v2 (CC-BY-4.0). On 10 minutes of a podcast it matched 92% of YouTube's words, word starts 0.05 s median, about 10x real time on a laptop CPU.
  - **24 European languages** (Spanish, French, German, Italian, Portuguese, Russian, Ukrainian, Polish, Dutch and more): Parakeet TDT 0.6B v3 (CC-BY-4.0), with punctuation and capitals. Spanish and German: 94 to 95%, about 13x real time.
  - **Every other language** (1,600+): Meta Omnilingual ASR CTC 1B (Apache-2.0), lowercase without punctuation. 90 to 97% agreement with YouTube on Hindi, Japanese, Arabic, Korean, Indonesian, Turkish and Vietnamese, about 2x real time (`BAMIO_SPEECH_MODEL=fast`: the 300M model, 2 to 7 points lower, 4 to 8x). It sometimes slips into a neighbouring Indian script (Bengali written partly in Devanagari); those letters are mapped back, since the Indian scripts share one Unicode layout.
  - Every word gets its time from the audio. Words in scripts without spaces (Chinese, Japanese, Thai...) come from dictionary word breaks (`Intl.Segmenter`), with Japanese endings kept on their word. Older projects have a "Transcribe again" button, which also moves AI clips to where their words are actually spoken (`src/lib/clips/relocate.ts`).
- **Preview matches export, in every script.** The editor draws captions with the same sizes, outlines and margins as the ASS file ffmpeg burns in, with the same font files: Bricolage Grotesque for Latin, and for other scripts a Noto font (OFL; 68 files, downloaded when first needed and checksum verified). `caption-fonts.json` records which characters each font has; the export switches font per run of characters (`\fn`, resized so every font's em matches, since libass sizes a font by its full height) and the preview declares the same files with the same `unicode-range`, so both pick the same font for every character. The export uses libass's complex shaping (Indic conjuncts) and right-to-left layout. libass can't wrap text without spaces, so caption lines in those scripts are kept narrow enough to fit and long titles are broken into lines.
- **Links are checked** before yt-dlp sees them: http(s) only, and hosts that resolve to private or loopback addresses are refused.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run check` | Typecheck (with route types) + lint + unit tests |
| `npm test` | Unit tests (Vitest): time and caption maths, timed words and phrases in any script, caption fonts, crop, clip clean-up, ASS output, ffmpeg arguments, URL safety, byte ranges, store (locking, restarts), HTTP helpers, AI helpers, live capture rules |
| `npm run test:e2e` | End-to-end tests (Playwright on installed Microsoft Edge, mock AI). Reuses a server on port 3100 or starts `next dev` there. Makes a test video with ffmpeg and a committed speech track, uploads it, transcribes it on the device, finds clips (mock AI), edits, exports and checks the MP4 with ffprobe. |
| `npm run setup:media` | Downloads or updates yt-dlp (re-run when a site stops working), and the speech models and caption fonts for every language (`BAMIO_PREFETCH=english` for English only; anything skipped downloads on first use) |
| `npm run ai:check` | Checks the Gemini key, JSON output and audio input on the main and fallback models |

Opt-in tests: `E2E_LIVE=1` imports part of a real YouTube video; `E2E_LANGUAGES=1` (or `hi,ja,ar,es`) imports real Hindi, Japanese, Arabic and Spanish videos, checks the detected language, the script and the caption fonts, and exports (preview and export frames go to `qa/languages/`); `E2E_LIVE_TWITCH` / `E2E_LIVE_YOUTUBE` / `E2E_LIVE_KICK` capture from live channels; `E2E_LIVE_AI=1 E2E_PORT=<port>` runs real Gemini transcription against a server started without mock AI; `E2E_SCREENSHOTS=1` saves screenshots to `qa/screens/`.

Tip: Next.js allows one `next dev` per project. If one is already running on port 3000, run the tests against a production build instead: `npm run build`, then `BAMIO_AI_MOCK=1 npx next start -p 3100`, then `npm run test:e2e`.

## Limitations

- **Only import videos you own or have permission to use.** Some sites block downloads, need a sign-in, or limit by region; Bamio explains what went wrong, and uploading the file always works.
- **Live streams** (YouTube, Twitch, Kick and other HLS live sources) are captured, not streamed into the editor: choose how far back to start (when the stream allows it) and how long to keep recording, and the capture is then processed like any video. How far back depends on the stream: Twitch goes back to the start of the stream (through its in-progress VOD, when the streamer keeps past broadcasts); YouTube goes back as far as the stream's rewind (DVR) history, often an hour; Kick and other short live playlists only keep about 30 s, which every capture includes. Twitch captures from the live picture (no VOD) can include Twitch's ads.
- **Limits:** 3 hours per video (import part of a longer one), 4 GB per upload, 60 clips per project, 100 projects per user, clips from 3 seconds to 3 minutes.
- **Transcription needs CPU:** per 10 minutes of video on a laptop, about 1 minute for English and European languages and about 5 for other languages (`BAMIO_SPEECH_MODEL=fast`: about half). The models (about 1.9 GB for every language) download with `npm run setup:media`, or the first time a language needs them.
- **Captions in languages other than English and the European ones are lowercase, without punctuation** (that's how Omnilingual writes), and accuracy varies by language: excellent for widely spoken languages, rougher for some (Nepali and Bengali agreed with YouTube's own captions only 70 to 80% of the time). Captions can be fixed word by word in the editor.
- **Credits:** NVIDIA Parakeet (CC-BY-4.0: credit NVIDIA if you ship the app), Meta Omnilingual ASR (Apache-2.0), OpenAI Whisper (MIT), Silero VAD (MIT), Noto and Bricolage Grotesque fonts (OFL).
- **Windows Smart App Control** can refuse the speech engine's unsigned DLLs for a while (it happened twice here, then allowed them again). Transcription then fails with a message saying so; try again later.
- **One server process.** The queue and rate limits live in memory, so run one instance (or add a shared queue before scaling out).

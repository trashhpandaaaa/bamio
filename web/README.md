# Bamio web app

Bamio turns one idea into a finished vertical (9:16) video: AI hooks, a scene-by-scene script, pictures, voice-over, word-by-word captions, an AI director that gives one-click notes, and an MP4 export rendered in the browser.

Built with Next.js 16 (App Router, Turbopack), React 19, TypeScript and Google Gemini. The visual design comes from the Phase A/B design work in `../design/` (direction: Hook).

## Quick start

```sh
cd web
npm install
cp .env.example .env.local      # then paste your key into GEMINI_API_KEY
npm run ai:check                # confirms the key and models work
npm run dev                     # http://localhost:3000
```

Get a Gemini API key at https://aistudio.google.com/apikey.

**No key yet?** Run in demo mode with deterministic fake AI answers:

```sh
# PowerShell
$env:BAMIO_AI_MOCK="1"; npm run dev
# bash
BAMIO_AI_MOCK=1 npm run dev
```

You can also make a video without AI at all ("Write it myself").

## Configuration (`web/.env.local`)

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | none | Required for AI. Stays on the server; never sent to the browser. |
| `BAMIO_TEXT_MODEL` | `gemini-3.8-flash` | Hooks, script, director notes (JSON output). |
| `BAMIO_VOICE_MODEL` | `gemini-3.8-flash-tts` | Voice-over (6 prebuilt voices offered). |
| `BAMIO_IMAGE_MODEL` | `gemini-3.1-flash-image` | Scene pictures at 9:16. **Needs a paid plan.** Without it, upload your own pictures; scenes without a picture render as bold text cards. |
| `BAMIO_AI_MOCK` | off | `1` = fake AI, for demos and end-to-end tests. |

Model IDs change over time. If `npm run ai:check` reports "model not found", set the current ID from https://ai.google.dev/gemini-api/docs/models.

## How it works

1. **Create** (`/new`): pick a format, describe the idea, set length, tone and voice. Gemini writes three hooks; you pick one or write your own. Gemini then writes 4 to 8 scenes (caption, voice-over, picture prompt, shot, length), fitted to the target length.
2. **Storyboard**: edit every scene; make or upload pictures (drag and drop works); record voice-over. Editing a line marks its voice-over out of date.
3. **Edit**: live preview with the real renderer, timeline (pictures, captions, voice), caption style (pop / clean / boxed), cut or fade, voice. Space plays and pauses; arrow keys, Home and End scrub.
4. **Director**: Gemini reviews the hook, pacing and captions and returns notes; "Apply" makes the change in one click.
5. **Export**: renders 1080 x 1920 in real time with the voice-over mix and downloads MP4 (or WebM where MP4 recording is unsupported).

## Architecture

```
src/
  app/
    page.tsx                 landing page (static)
    new/                     create flow
    projects/                dashboard
    projects/[id]/           workspace: storyboard, edit, director, export tabs
    api/ai/*/route.ts        server routes that call Gemini (hooks, script, image, voice, director, status)
  lib/
    project/                 schema (zod), reducer ops, timeline maths, templates
    ai/contracts.ts          request/response schemas shared by client and server
    ai/server/               Gemini client, prompts, mock provider, route wrapper (server-only)
    render/                  canvas renderer, media loading, real-time export
    storage/db.ts            IndexedDB (projects and media blobs)
    audio/wav.ts             PCM to WAV, duration
  hooks/                     useProject (autosave), usePlayback, useSceneMedia, ...
  styles/                    design tokens and components from the design system
```

Key decisions:

- **One renderer** draws every frame for both preview and export, so the preview is exactly what you export.
- **Model output is untrusted.** Every Gemini response is validated with zod, leniently: long text is trimmed, durations clamped, bad values replaced; invalid JSON is retried once.
- **API routes** validate input, cap body size, reject cross-site requests, and map Gemini errors to clear messages (rate limit, bad key, model unavailable, blocked content).
- **Local-first storage.** Projects and media live in the browser's IndexedDB. Nothing is uploaded except the text sent to Gemini.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run check` | Typecheck + lint + unit tests |
| `npm test` | Unit tests (Vitest): schemas, timeline, reducer, storage, WAV, mock provider, API wrapper |
| `npm run test:e2e` | End-to-end tests (Playwright, installed Microsoft Edge, mock AI): the full idea-to-MP4 flow, autosave, dashboard, errors, keyboard |
| `npm run ai:check` | Checks your Gemini key and models (`-- --image` to include pictures) |

## Limitations

- **Single-user, local app.** There is no sign-in, and the AI routes have no rate limiting. Do not deploy it publicly as-is, or anyone could spend your Gemini quota. Add authentication and rate limiting first.
- **Videos live in one browser.** Clearing site data deletes them; they don't sync between devices.
- **Export runs in real time** (a 30-second video takes about 30 seconds) and needs the tab to stay visible. It needs a recent Chrome, Edge or Firefox.
- **Picture generation needs a paid Gemini plan.** Text and voice work on the free tier.
- **The live Gemini integration has not been exercised end to end in this repo's tests** (no key was available). The full flow is covered with mock AI; run `npm run ai:check` after adding a key.

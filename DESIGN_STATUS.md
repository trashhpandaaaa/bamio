# Bamio design status

Last updated: 2026-10-06 (the language demo shows the most spoken languages)

## Current phase

**Engineering v0.2: Bamio is a clipping and editing tool. Built and verified 2026-09-28.**

On 2026-09-27 the user said the only features needed are (1) **video clipping** from YouTube, Twitch, Kick and other sites and (2) **video editing**. The idea-to-video features (hooks, script, AI pictures, TTS voice-over, AI director, templates, IndexedDB storage, in-browser renderer) were removed. Clerk sign-in, the profile page and the design system were kept.

### What the app does now

| Area | Status |
|---|---|
| Landing (`/`) | Rebuilt 2026-09-30 with opus.pro as a structural reference (see Landing page after OpusClip): the link field is the hero, a demo of a stream turning into three captioned clips, "AI that finds the moment, not just a clip." (added at the user's request: how Bamio picks a moment), the how-it-works bento, a working mini caption editor, every-language and live-stream cards, FAQ, a closing panel with the link field, and a link bar that follows the page. |
| Import (`/new`) | Paste a link (checked and previewed as you paste: title, channel, length, thumbnail) or upload a file (drag and drop, chunked upload with progress, speed and cancel). Optional part-of-video range (required over 3 hours). Settings: spoken language (detected automatically, or picked from a list), find clips with AI, clip length, format, captions and style; defaults come from the profile. |
| Processing | A durable background job with a stepper: download (yt-dlp) or upload, prepare (remux or re-encode to browser-safe MP4, thumbnail), transcribe on the device in any language (sherpa-onnx, a time for every word; see Every language below), find clips (Gemini on the transcript). Survives leaving the page and a worker crash: another worker takes the job over within about 30 s (see Production architecture). |
| Project (`/projects/[id]`) | Source player with a scrub bar that shows the clips; mark a clip with I / O or typed times; AI clips with score, reason and title; best-first or in-order; preview, export, download and delete per clip; "Find more clips" with a length choice; rename and delete project. |
| Clip editor (`/projects/[id]/clips/[clipId]`) | Studio surface. Live preview at 9:16, 1:1 or 16:9; fill (crop with drag-to-reframe and a focus slider) or fit (blurred fill); captions drawn like the export (pop, clean, boxed; lower third or middle); editable caption words; title overlay; trim bar over a filmstrip with draggable, keyboard-operable handles; autosave; previous / next clip; "Use this look for all clips"; export with progress, Watch and Download; marks an export out of date after later edits. |
| Export | Server-side ffmpeg: cut, crop or fit, ASS captions and title burned in (Bricolage for Latin, a Noto font for every other script, complex shaping, right to left), H.264 / AAC 1080p MP4 with fast start. |
| Profile | Clerk profile plus "Clip defaults" (spoken language, find clips, clip length, format, captions, caption style). |
| Pricing (`/pricing`) | Starter, Pro (most popular) and Team, monthly or every 3 months ("Save $6 compared to $36 monthly"...); included features, then a folded "Coming soon" list per plan; buy with Stripe Checkout, switch plans in Stripe's portal; billing questions. Public. |
| Plan & billing (`/billing`) | The plan and its renewal, AI minutes left this month, projects kept, Manage billing (Stripe portal). In the account menu when plans are on. |
| Admin (`/admin`) | For the people who run Bamio (see Admin panel): overview numbers, users, jobs and errors, money. 404 for everyone else. |
| Data and storage | Projects, transcripts, jobs, billing and usage in Postgres; media (sources, thumbnails, frames, exports, a followed stream's segments) in a local folder or S3 / R2 / MinIO, per Clerk user and project. |

### Caption timing (2026-09-28)

The user reported that caption timing was off. What was found, in order:

1. **First fix, word timing inside phrases.** Gemini gives phrase-level times and words inside a phrase were estimated. A local Whisper aligner (Transformers.js, teacher-forced cross-attention) measured word times: 0.09 s median on a clean 58 s test. But on the user's real import, a 2.4-hour podcast ("Joe Rogan Experience #2440"), measured against YouTube's own word timings, it was fine for 20 minutes and then minutes off for the rest.
2. **Root cause: Gemini's transcript itself.** On long audio Gemini drops speech (the first 10-minute chunk came back with only its first minute) and misplaces phrases by minutes. A controlled test on 10 minutes of the podcast: main model, one 10-minute chunk: text complete, median phrase error 1.1 s, worst 540 s. Lite model: 62% of the words missing, median 18.9 s. 2-minute chunks help, but the key's free tier allows only 20 requests a day on the main model (a 2.4-hour video already needs 15).
3. **Fix: transcribe English on the device.** `web/workers/transcribe.mjs` runs Silero VAD (MIT) and NVIDIA Parakeet TDT 110M (CC-BY-4.0, int8, about 110 MB) through sherpa-onnx (Apache-2.0, prebuilt for Windows, macOS and Linux) in a child process. Each token gets a time from the audio; words are grouped into caption phrases (break at sentences, pauses, commas, 14 words at most).
   - **Measured on the full 2.4-hour podcast:** 6.5 minutes on this laptop (22x real time), 29,929 words (Gemini had returned 21,188), and **97% of words within 0.25 s of YouTube's timings (median 0.07 s)**, the same in every 10-minute block from start to end.
   - Compared engines on this laptop (Ryzen 5 7535HS): Whisper base 4.4x real time (Transformers.js and sherpa-onnx alike; 85% word agreement), Whisper tiny 7.7x (76%), Parakeet 110M 23x (90%). The multilingual MMS forced aligner was ruled out (CC-BY-NC).
   - Gemini now does one request per video (finding clips). Other languages still use Gemini transcription (now 5-minute chunks) with approximate timing; the import form has a "Spoken language" setting (English / Another language), also in Clip defaults.
   - Projects transcribed earlier show "Transcribe again" (project page and clip editor). It replaces the transcript; clips stay, but AI clips found from the old transcript may be cut in the wrong place, so re-finding clips is worth it.
4. Also fixed along the way: audio for transcription is resampled onto the video's timeline (`aresample=async=1:first_pts=0`); the progress stepper records its planned steps (it used to drop finished steps); `next build` no longer traces `web/.data` or `web/.models` (it once tried to read a 1.4 GB video); the highlighted "pop" word in the editor preview now makes room for itself like the export does.
5. Removed: the Whisper aligner and `@huggingface/transformers`. The `syncing` job status stays in the schema only so projects saved with it still load.
6. **Follow-up (user: "still not synced"):** the user's podcast still had the old Gemini transcript. The first aligner run had marked it `captionTiming: "synced"`, so the "Transcribe again" notice never showed. Now each project records `transcriptEngine` ("device" or "gemini"); any English project without an on-device transcript shows the notice (`needsRetranscribe`). "Transcribe again" also **moves AI clips** to where their words are actually spoken (`src/lib/clips/relocate.ts`: word-triple voting, then word-by-word alignment); hand-marked clips never move. Applied to the user's podcast: new transcript installed (97% of words within 0.25 s of YouTube's timings), and all 26 AI clips repositioned (25 automatically, some by up to 19 minutes; one, picked from the half-aligned transcript, moved by hand to its passage). 5 exports are now marked out of date. The Gemini client now follows a changed key in `.env` without a restart. A new end-to-end check samples the preview during playback and confirms the highlighted caption word is the word being spoken at that moment.

### Missing words and live streams (2026-09-28, later)

**Missing words.** The user saw "a word or two missing here and there". Measured on the podcast against YouTube's words: 5.3% of words dropped, 87% of them short words inside speech ("and", "I", "you", "the", "it's"), not at speech-segment edges. Benchmarked on 10 minutes: Parakeet 110M matched 90% of YouTube's words (word starts 0.074 s median, 0.198 s p90, 20x real time); **Parakeet TDT 0.6B v2 matched 92% (0.054 s / 0.106 s, 9.4x real time)**. VAD padding, a lower VAD threshold and 30 s segments made no difference. Decision: 0.6B v2 is the default (`BAMIO_SPEECH_MODEL=fast` keeps the 110M model); about 480 MB download; a 2.4-hour video takes about 15 minutes instead of 7.

**Live streams.** Pasting a live link now offers a capture instead of an error. What each site allows, found by testing live channels:

| Site | Go back in time | Record from now |
|---|---|---|
| Twitch (past broadcasts on) | Yes, to the start of the stream: `yt-dlp --live-from-start` resolves the channel to its in-progress VOD, and any time range of it downloads | Yes (Bamio waits, then downloads that stretch of the VOD) |
| YouTube | Yes, as far as the stream's rewind (DVR) history: its separate video and audio HLS playlists held 1 hour (5 s segments) and 15 minutes (2 s segments) on the streams tested. (`--live-from-start` can't cut a time range: "This format cannot be partially downloaded". The combined-format playlist, which yt-dlp lists only some of the time, holds 30 s.) | Yes |
| Kick | No (live playlist about 28 s, always included; no `--live-from-start`) | Yes |

- Import form: "Start from" (when the stream can rewind: now, 1 to 60 min ago, or the start of the stream) and "Keep recording for" (up to 1 hour; "Stop at now" when rewinding). A new "Recording live" step shows progress, and the project page has "Stop recording now" (ffmpeg gets "q" on stdin and closes the file cleanly; the capture is MPEG-TS so even a cut-off recording is usable). The capture then goes through prepare, transcribe and find clips like any import.
- How the ffmpeg recorder works: when the link is pasted, Bamio measures how much history each way of recording the stream holds (one combined playlist, or video plus audio playlists); 60 s or more is offered as "go back". A capture uses the simplest way that reaches back far enough, starts that many segments from the playlist's end (`-live_start_index -N`) and records an exact length (`-t` on each input), stopping early on "q". Short playlists are included whole; long (DVR) ones start at the live edge when not rewinding.
- Lessons:
  - YouTube's "video only" live playlists sometimes carry audio too (checked with ffprobe; then one input is used), sometimes not.
  - Two live inputs need `-copyts` to stay in step (their playlists can start a segment apart). An output `-t` then counts from the stream's start and nothing gets recorded, but an input `-t` counts from that input's own start.
  - YouTube's separate audio playlist can repeat about 2 s where two segments join. Copied as is, all the sound after that point played 2 s late (measured by comparing silences with the timestamps). With two inputs the audio is therefore re-encoded while recording (`aresample=async=1`, which drops the repeat), and preparing any live capture re-times its audio again (fills gaps, pads a late start with silence). The video is always copied.
  - yt-dlp lists YouTube's combined 30 s playlist on some lookups and not others, so taking the first format made "go back" come and go between the form and the capture ("This stream can only be recorded from now on"). Every way of recording is now measured.
  - A Twitch VOD that is still growing needs `--live-from-start` too, or yt-dlp waits at its live end.
- Limits: Kick and Twitch without a VOD only keep about 30 s of history; a Twitch capture without a VOD records the live picture and can include Twitch's ads; a live capture can't be retried once the moment has passed (Twitch captures can, from the VOD).

### Every language (2026-09-29)

The user asked: "Make sure it supports every language". Before, English was transcribed on the device and every other language by Gemini (approximate timing, 20 requests a day on the free tier, and no fonts for other scripts in the export). Now every language is transcribed on the device with a time for every word, and captions render in every script.

**Models, measured on 5 minutes of a real YouTube talk per language against YouTube's own captions in that language** (character agreement, letters only; word starts compared where YouTube has word times; speed on this laptop, 4 threads):

| Language | Parakeet v3 | Omnilingual 300M | Omnilingual 1B | Word starts (median) |
|---|---|---|---|---|
| Spanish | 94%, 13x | 93%, 7x | 95%, 3x | 0.10 s |
| German | 95%, 13x | 90%, 7x | 92%, 3x | 0.02 to 0.05 s |
| Hindi | | 91%, 8x | 93%, 2.5x | 0.05 s |
| Japanese | | 89%, 5x | 92%, 2x | 0.03 s |
| Arabic | | 89%, 5x | 91%, 2x | 0.03 s |
| Korean | | 90%, 5x | 93%, 2x | 0.07 s |
| Indonesian | | 86%, 4x | 93%, 1.5x | 0.10 s |
| Turkish | | 95%, 6x | 97%, 2.4x | 0.02 s |
| Vietnamese | | 84%, 4x | 90%, 1.6x | 0.03 s |
| Nepali | | 66%, 4x | 72%, 2x | 0.02 s |
| Bengali | | 78%, 7x | 68%, 3x (script slips, now repaired) | 0.06 s |
| Chinese | | 58%, 5.5x | 62%, 1.7x | (YouTube's captions are Traditional, ours Simplified: the content matched well) |

Decisions:
- English stays on Parakeet TDT 0.6B v2. **24 European languages** (bg, hr, cs, da, nl, et, fi, fr, de, el, hu, it, lv, lt, mt, pl, pt, ro, sk, sl, es, sv, ru, uk) use **Parakeet TDT 0.6B v3** (CC-BY-4.0, punctuation and capitals). **Every other language** uses **Meta Omnilingual ASR CTC 1B** (Apache-2.0, 1,600+ languages; lowercase, no punctuation); `BAMIO_SPEECH_MODEL=fast` uses the 300M model (2 to 7 points lower, 2 to 3 times faster). Downloads: about 1.9 GB for every language (`npm run setup:media`), or each model the first time a language needs it.
- **Detecting the language:** Whisper tiny (MIT) on up to 29 s of speech from each of three points of the video (10%, 45%, 80%; five points since 2026-09-30, see English mixed with another language), by vote, so a music intro or an ad doesn't decide it. It was right on all 12 test languages (0.6 s each; Whisper base was also 12/12, slower). The import form and Clip defaults have a "Spoken language" picker: "Detect automatically" (the new default) or a language from a list of about 120; anything unlisted is still transcribed when detected. The project page shows the language.
- **Omnilingual isn't told the language**, and on Bengali it wrote about a quarter of the letters in Devanagari (the 1B model more than the 300M). The Indian scripts share one Unicode layout, so letters in a neighbouring Indian script are mapped back to the language's own script (or the script most of the transcript is in), with a few letters Bengali writes differently (va as ba).
- **Words without spaces:** Chinese, Japanese, Thai, Lao, Khmer, Burmese and Tibetan are split into words with `Intl.Segmenter` (ICU dictionaries). ICU cuts Japanese verbs into single kana (言|っ|た), so hiragana after kanji or katakana, and one-kana particles, stay with their word (言った, 行きましょう, みんなで). Transcript text keeps a space between all words (the caption editor edits them as units); captions leave the spaces out between words of those scripts.
- **Caption fonts:** Bricolage has only Latin (with Vietnamese). Every other script uses a Noto font (OFL): 64 static fonts at ExtraBold (or the heaviest weight made), plus Noto Sans CJK Bold (JP, KR, SC, TC), 30 MB in all, pinned to a commit and checked by SHA-256, downloaded when first needed (or by setup). `web/src/lib/server/caption-fonts.json` holds each font's coverage (from its cmap), libass family name and height; it was generated with fontTools from the files. The export switches font per run of characters (the first font in the list that has the character; Chinese characters prefer JP, KR, TC or SC by language) and scales each run so its em matches Bricolage's (libass sizes a font by usWinAscent + usWinDescent: Arabic 2.17 em, Devanagari 1.91, Bricolage 1.56). The preview loads the same files as one family, "Bamio Caption", with the same coverage as `unicode-range` (`/api/fonts/captions.css`, files from `/api/fonts/<file>`), so both pick the same font for every character.
- **libass findings:** with the `subtitles` filter it used simple shaping, so Devanagari conjuncts broke (नमस्ते drawn with a visible virama); the export now uses `ass=...:shaping=complex`. This libass build has no Unicode line breaking (`wrap_unicode` unsupported), so lines without spaces never wrap: caption lines in those scripts are cut to fit the frame (pop 11 em, clean and boxed 16 em) and long titles are broken into lines at word boundaries. Arabic and other right-to-left scripts lay out correctly; the preview uses `dir="auto"`.
- Gemini now only picks clips (and is told the spoken language, and that the transcript may have no punctuation). `BAMIO_LOCAL_TRANSCRIBE=0` still sends transcription to Gemini. Projects transcribed by Gemini before (any language) show "Transcribe again".
- **Windows Smart App Control** blocked the speech engine's unsigned DLLs (`sherpa-onnx-c-api.dll`) for a while today, from 18:11 ("An Application Control policy has blocked this file"; Code Integrity events 3033 and 3077), then allowed them again, like it once did to Next's compiler. Transcription now fails with a message that says so. The WebAssembly build of sherpa-onnx (npm `sherpa-onnx`) works without native DLLs, but single-threaded (0.9x real time), so it's not used.

### Production architecture (2026-10-02)

The user pasted a production-readiness checklist (keys, Postgres, S3/R2, Redis and BullMQ, workers, durable jobs, storage, import reliability, editor, AI, billing and abuse, observability, deploy, legal, QA, launch gates) and chose to start with the architecture: Postgres, object storage with signed links, a durable queue with separate media workers, and a Dockerfile. Keys were checked first: none are in git (`.env*` is ignored; `.env.example` has placeholders only).

- **Postgres** (`web/src/lib/server/db.ts`, postgres.js; migrations in `web/db/migrations/`, applied in order under an advisory lock): `projects` (one zod-validated jsonb document per project, as before), `transcripts`, `billing_accounts`, `usage_entries` (keyed, so a retried import counts once), `jobs`. `mutateProject` changes a project inside a transaction with its row locked (`FOR NO KEY UPDATE`, so transcript writes don't deadlock with it), and can queue a job in the same transaction. Creating a project checks the plan's project limit under an advisory lock per user. `DATABASE_URL` is required in production; development uses `npm run db:local` (a Postgres in `web/.pg` on port 54329, started detached from the terminal so Ctrl+C in another command can't kill it). The user's 5 projects, 5 transcripts and 2 billing records were copied in from the JSON files (`scripts/db-import-disk.mjs`; the files are left in place).
- **Storage** (`storage.ts`): one interface, two drivers. Local keeps the old folder layout under `BAMIO_DATA_DIR`; S3 works with AWS, R2 and MinIO. Keys are `users/<user>/projects/<project>/...` from `mediaKeys` and checked against a pattern. The browser gets media from signed links (`serve` redirects), signed with the time floored to the hour so a link stays the same for an hour and the browser cache works; `S3_PUBLIC_ENDPOINT` signs for the address browsers use when it differs (Docker). Uploads still arrive in 8 MB chunks and go to S3 as a multipart upload (part n = offset / 8 MB + 1; the parts' etags are kept on the project). Work in progress is in a local scratch folder per project (`BAMIO_WORK_DIR`); only finished files are published.
- **Followed streams with S3** (`live-media.ts`): the capturing worker uploads each new segment, then the playlist. Readers on other machines get a closed snapshot whose segment links are signed URLs; ffmpeg needs `-protocol_whitelist file,http,https,tcp,tls,crypto` for such a playlist, which `bin.ts` adds to any `snap-*.m3u8` input. The editor's playlist goes through the server (`proxy`), its segments are signed links.
- **The job queue** (`queue.ts`): a `jobs` row per import, analysis, transcription, export, follow and finish-follow. One active job per project, kind and clip (a partial unique index makes queuing idempotent). Workers claim with `FOR UPDATE SKIP LOCKED` in priority order (Pro and Team first, replacing the in-memory priority queue in `limiter.ts`), at most 2 running per user per pool, and hold a 30 s lease renewed every 10 s. An expired lease means the worker died: another worker claims the job (attempt + 1). Retries wait 30 s, then 2 min, 8 min... (up to 30 min); errors that retrying can't fix (bad input, `HttpError` under 500, time limits) fail at once. Live captures get one attempt (the moment has passed). Cancel and stop are flags seen at the next heartbeat. NOTIFY wakes idle workers at once; they also poll every 3 s. Finished jobs are pruned after 30 days.
- **Workers** (`worker.ts`): pools for imports (2 at once), exports (2) and streams (4), set with `BAMIO_*_SLOTS`. Each kind has a time limit (import 8 h, find clips and transcribe again 6 h, export 2 h, follow its maximum plus 2 h). On SIGTERM a worker stops claiming, aborts its jobs and hands them back without counting an attempt. The web server runs a worker itself (`instrumentation.ts`) unless `BAMIO_WORKER=off`; then `node dist/worker.mjs` (esbuild bundle, `npm run build:worker`) runs on any machine with the same environment. Job handlers were made safe to run again: an import that finds its video already prepared goes straight to transcription, and a followed stream resumed by another worker finishes what was captured.
- **Health and deploy:** `GET /api/health` (public, nothing about users) reports the database, storage, media tools and the queue (waiting, running, oldest wait) with 200 or 503. A database that can't be reached gives a 503 "can't reach its database" everywhere. `web/Dockerfile` (one image for both roles: Node 24 slim, tini, a non-root user, migrations on start, a health check) and `web/compose.yaml` (Postgres 18, MinIO and its bucket, a web server that only queues, a worker; `--scale worker=N`).
- **Decision: a Postgres queue instead of Redis and BullMQ.** Same guarantees for this load (durable, leased, retried, prioritised, cancellable), one less service to run and back up, and a job is queued in the same transaction as the project change that asks for it, so neither can exist without the other. `queue.ts` is small, so it can be swapped if volume ever needs it. Redis and Docker weren't available on this machine either.

### Language demo: the most spoken languages (2026-10-06)

The user asked for the landing page's language card to show globally used languages instead of Nepali, Hindi and Arabic. It now cycles Spanish, Chinese, Japanese, Korean, Portuguese and English ("Let's start today's video" in each, Chinese, Japanese and Korean without punctuation, as Bamio's captions come out), and the paragraph under it names the same five "and 100 more". The QA sweep now waits for fades to finish before measuring contrast (a clip still fading in was a false alarm).

### Free trial: following a stream capped too, and one import at a time (2026-10-05, later)

- **The trial's 30 minutes now cap a followed stream's recording.** Imports and "capture a part" were already refused past the minutes left, but following counted minutes only as captions caught up, and stopped captioning (not recording) when they ran out: a trial account could record up to 12 hours (`LIMITS.maxFollowSec`) of a stream, captioned for 30, and clip all of it. Now `followLimits` (`src/lib/clips/live.ts`) takes the minutes left when following starts: no further back than that, and the recording stops once that much (plus the import's minute of grace) is captured, with a note on the project. Paid plans get the same rule (Pro's 400 minutes: 6 h 41 min of stream). The import page says so ("or 30 min (your minutes left) are captured").
- **The free trial brought real users, and the 4 GB Droplet couldn't keep up.** Seven accounts imported within a few hours; with two transcriptions at once (about 1 GB each) plus a followed stream's captions, the server swapped and imports waited 2 to 3 hours (the new alerts emailed the superadmin 5 times). Production now runs `BAMIO_IMPORT_SLOTS=1`; DEPLOY.md says so for 4 GB. With more users, the next step is the 8 GB / 4 vCPU Droplet (two at a time again), or a separate worker machine.

### Gaming clip reel on the homepage (2026-10-05, later)

The user asked for real gameplay clips from a few streamers on the homepage, to make it more attractive. Streamers' clips weren't used: their footage and faces are theirs (and partly the game publishers'), and a sales page would read as their endorsement. The user chose licensed stock gameplay instead.

- **The reel** (`components/landing/clip-reel.tsx`), a new section right after the hero ("the plays worth posting."): six 9:16 phones side by side, every other one lower; a row to swipe below 1100px (focusable, so the keyboard scrolls it). Each clip loops silently with Bamio's own "pop" captions word by word (`DemoCaption`, the export's sizes), and below it a title, a score and "0:41 from a 3 h 12 min stream". They're examples (the list is labelled "Example clips from gaming streams"; the footer credits Mixkit).
- **Footage**: six Mixkit videos (Stock Video Free License): a celebration (#51612), an over-the-shoulder sci-fi shooter (#5444), a gamer who goes from focused to shouting (#45814), a neon racing flythrough (#5399), a gamer yelling at the screen (#45735) and a VR player (#40464, filmed vertical). Rejected: clips showing a famous game on screen (a battle royale in #43532 and #43599, a kart racer in #2975) or a brand-name controller (#23501), and an esports shot whose camera drifts between players (#43538). `scripts/landing-footage.mjs reel` crops each to 9:16 where the face or screen stays in frame for the whole loop, at 360x640 (about 120 to 400 KB each, 1.5 MB in all as WebM).
- **Weight**: a clip loads and plays only while it's on screen and after the page has loaded (`Footage`); with reduced motion or data saving it stays a still with the caption shown whole. The landing e2e test checks the reel plays once scrolled to.

Verified: typecheck and lint, the build, the landing tests, the layout check at 320 to 1440, and the public sweep in both themes (no findings).

### Before real users (2026-10-05, later)

The user pasted a review listing what Bamio needs before real users, and picked all of it: legal pages and account deletion, a free way to try Bamio (the free first video), a trimmed pricing page, CI, error tracking, logs and alerts. The company's details for the legal pages weren't given yet: placeholders, kept out of sight until then.

- **Account deletion.** Clerk's own Delete account was switched on in production, so a user could delete their Clerk account while their projects, media and Stripe subscription stayed (and kept charging). Now: Profile → Delete account (tick, confirm) → `DELETE /api/account` records the request in `account_deletions` (migration 0007) and deletes the Clerk user at once; a sweeper in the workers (`accounts.ts`, like the mailer) ends the Stripe subscriptions (no refund) and deletes the customer, stops the jobs, removes the media and every row, then the Clerk user, retrying with backoff. Clerk's webhook (`/api/clerk/webhook`, `user.deleted`, Svix-signed) covers deletions in Clerk's dashboard. Clerk's own button is hidden. The e2e test found that `closeBilling` refused to run with plans off (test servers): it now does nothing then, like every Stripe call.
- **Legal pages.** `/terms`, `/privacy`, `/takedown`, drafted from what the code actually does (providers: DigitalOcean in the US, Cloudflare, Clerk, Stripe, Google Gemini with transcript text only, Resend, Sentry; retention: emails 180 days, backups 14; the referral cookie; deletion). Company details in `src/lib/legal.ts`; with `ready: false` the pages are `noindex`, out of the footer, sitemap and FAQ. To publish: fill in the details, set `ready: true`, have a lawyer read them.
- **Free first video.** For accounts that never had a plan: 30 minutes of video over the account's life (`FREE_TRIAL`), every feature, one project at a time; then `trial_used`. Ex-subscribers don't get it. Shown on the import page ("Your first video is free"), Plan & billing ("Your free trial: N of 30 minutes left"), Pricing (lede and FAQ) and the landing FAQ. Terms say it's once per person.
- **Pricing.** 41 coming-soon lines down to 5: Pro shows 4K export, silence and filler-word removal, AI face tracking and custom caption styling (the planned order), Team shows team members. Starter lists only what's built, and now says so: three formats with drag-to-reframe, captions in over 100 languages, live stream capture.
- **Monitoring.** Sentry (`@sentry/node` on the server and workers, `@sentry/nextjs` in browsers, loaded only with a DSN; no cookies, headers, bodies or tracing): unexpected route errors, Next's own, jobs that fail for a reason that isn't the user's, account deletions. In production every console line is JSON with the request id (Cloudflare's ray, returned as `x-request-id`) or the job. Alerts: every 5 minutes a worker emails the superadmins (`ops-alert`, once an hour per problem) about 3+ failed jobs in an hour, a job waiting 15+ minutes, or a deletion failing 3 times.
- **CI and uptime.** `.github/workflows/ci.yml`: check (with Postgres), build, worker bundle, Docker image, and e2e on Chromium (needs `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` secrets: skipped without). `uptime.yml`: `/api/health` every 10 minutes.

Verified: `npm run check` (184 unit tests, new: accounts, alerts and log lines, the trial, closeBilling with plans off), `npm run build`, the e2e suite with the new account deletion (a throwaway Clerk user) and legal page tests, the admin tests, the sweep (light and dark, axe), the layout checks with the new pages (the confirmation checkbox was 20px: now 24), and E2E_BILLING with the new trial tests.

Open, for the user: the company's details for the legal pages; a Sentry project (its DSN into `.env` twice); the Clerk webhook endpoint and its signing secret; the Clerk development keys as GitHub secrets for CI's e2e job; Sentry source maps (needs `SENTRY_AUTH_TOKEN` and Sentry's build plugin, left out for now). Next in the product: ship the coming-soon features in order, removing each `soon` flag.

### Full QA pass (2026-10-05)

The user asked for a full QA report and every problem fixed. Checked: production data, logs, Stripe, YouTube access, headers, sitemap, share images, Lighthouse on bamio.app, every automated suite, a new sweep of every screen in both themes, and real live streams (YouTube, Twitch, Kick).

Found and fixed:

- **Stripe's live webhook lacked the subscription events.** It had been made by hand in the dashboard with 18 events, none of them `checkout.session.completed` or `customer.subscription.*`. Both subscriptions so far were still saved (the billing page reads Stripe when people come back from checkout), but cancellations, failed renewals and their emails would have reached Bamio late or not at all. The missing events were added to the endpoint (signing secret kept). `WEBHOOK_EVENTS` in billing.ts is now the list, a unit test keeps `scripts/setup-stripe.mjs` equal to it, and the admin Money page warns when the endpoint misses any (`adminWebhookCheck`).
- **Marketing pages were rendered on every request** (`no-store`, about 0.45 s before the first byte): the site header used Clerk's `<Show>` in a server component, which reads the session. The signed-in links moved to client components (`account-links.tsx`); `/` and the four use-case pages are static again (cacheable, and the back/forward cache works). Pricing stays dynamic (it shows the visitor's own plan).
- **Phone load (Lighthouse mobile 68, largest paint 5.9 s):** the hero headline faded in from invisible, so its paint waited behind the scripts. It now rises without fading. Clerk's domain is preconnected (decoded from the publishable key).
- **Contrast:** the Twitch page's moment finder faded the lines outside the moment to 45% (2.1:1 on the dark panel); they now use the tertiary text colour (4.5:1 or more). axe's flag on the editor's "Pop" sample measures its black outline, not the volt fill people see: excluded in the sweep, with the reason.
- **Security and deploys:** HSTS header (one year). Caddy holds requests for up to 30 s while the app restarts (deploys showed a few seconds of 502s), and plain http redirects to `https://bamio.app/` (Caddy's own redirect added `:443`). Docker's build cache had reached 27 GB of the 77 GB disk: DEPLOY.md now prunes it after each update.
- **Admin:** "new users in 7 days" said 100 when it could only read 100; it says 100+.
- **Tests:** a new opt-in sweep (`E2E_SWEEP=1`: console errors, crashes, failed requests, axe WCAG 2.1 AA, light and dark); `E2E_BASE_URL` runs read-only tests against the live site; the Twitch capture-from-history test skips (instead of hanging 15 minutes) on a stream without a VOD, which `twitch.tv/bobross` is; the admin cancel test gets 30 s (its first call loads the whole job system).

Checked and fine: YouTube from the server with its cookies (the app's `--js-runtimes node` solves YouTube's challenge), Clerk production keys, swap, firewall, the nightly database dump, every sitemap page, share image and icon; Lighthouse accessibility, best practices and SEO at 100, desktop performance 96; live capture and follow on YouTube (Sky News) and Kick (ESL), follow on Twitch.

Open (the user's call): backups live on the Droplet itself (turn on DigitalOcean's weekly Droplet backups, or copy the dumps elsewhere); seven old unnamed prices in Stripe could be archived; Lighthouse's experimental "say what you see" check notes that the wordmark's visible text ("bamıo", with a dotless ı) isn't in its name ("Bamio home"), with no effect on the score.

### Admin panel (2026-10-04)

The user asked for an admin panel with four sections (all picked): an overview dashboard, users, jobs and errors, and money (plans, promo codes, referrals). Access: the user (trashhpandaaaa@gmail.com) is the superadmin, sujandahal711@gmail.com a normal admin.

- **Roles.** Superadmins are named on the server (`BAMIO_SUPERADMINS`, matched to the account's *verified* primary email in Clerk, so an unverified address can't claim it). Admins are rows in a new `admins` table (migration 0006), added and removed by superadmins from Admin → Admins. Admins see everything and can retry or cancel jobs; only superadmins give or take back free plans and manage admins. Every change goes into `admin_actions`.
- **Hidden.** Non-admins get a 404 at `/admin` and `/api/admin/*`, signed out too: no sign-in redirect, not in `robots.txt`. Admins get an "Admin" link in the account menu (`admin` role in `/api/system/status`).
- **Pages** are server components reading the database, Clerk and Stripe directly (`src/lib/server/admin.ts`, `adminRevenue` / `adminPromoCodes` in `billing.ts`); only the changes go through `/api/admin/*`. Tables scroll inside their box on phones.
- **Retry and cancel.** A retry runs the owner's own starter (`retryImport`, moved out of the retry route, `startExport`, `startAnalysis`, `startRetranscribe`), only for the newest job of its kind for that project. Cancelled jobs skip a job kind's `failed` hook, which would have left a project stuck mid-step, so `cancelJob` (`jobs.ts`) waits for the worker to let go and settles the project: an import fails with Try again, finding clips or transcribing again ends with a warning, an export fails. A followed stream is stopped instead (keeps the recording); finishing a stream's video can't be cancelled.
- **Money** shows subscriptions by plan from `billing_accounts` with their monthly value at list prices (promo codes not taken off), and money actually paid from Stripe's invoices (last 30 days and this month, cached 5 minutes).

Verified: `npm run check` (178 unit tests, new `admin.test.ts`: roles, unverified emails, plan grants, cancel then retry), `npm run build`, `npm run test:e2e` (9 passed), `E2E_ADMIN=1` admin e2e (outsiders 404, every section, a free plan given and taken back), `E2E_RESPONSIVE=1 E2E_ADMIN=1` responsive (pages, editor and the admin pages at 320 to 1440; a long email title overflowed at 320 and 390 and was fixed).

Next: watch the panel on the live data; possible additions if wanted: deleting a user's project, sending an email again, a chart of imports per day.

### More clips, ranked by hype (2026-10-04)

The user said Bamio isn't making as many clips as it should, and asked to rank them by hype and quality. On the server: a 28-minute stream got 1 clip, an 88-minute video 5 (of up to 15 asked), an hour-long stream 9. The prompt asked for "up to N, fewer if the video has fewer strong moments", and the model took the way out; scores bunched at 85 to 95.

- **Count:** `clipTarget` now asks for about one clip per 90 s (short clips), 150 s (medium) or 210 s (long), at least 3 where they fit, at most 40 per search (projects keep up to 60): 28 minutes of medium clips gets 11, an hour 24, 88 minutes of long clips 25, two hours or more 40. The prompt says "Find N clips … return all N, best first: after the standout moments, take the next most watchable ones and rate them lower."
- **Ranking:** the model rates each clip 1 to 10 on hype (energy and emotion at their peak: excitement, shouting, laughing, shock, a clutch play or fail, a heated argument), hook (the first 3 seconds) and payoff; `hypeScore` = 4 × hype + 3.5 × hook + 2.5 × payoff (10 to 100). Best-first order sorts on it as before.
- **A hype signal from the audio:** transcription already decodes the audio to 16 kHz PCM; it now also measures each second's loudness (dBFS, `loudnessMeter`) into `Transcript.loudness` (about 40 KB for 3 hours; left out of the editor's transcript download). Followed streams merge each piece's loudness (`mergeLoudness`). The prompt marks lines ! (top fifth) and !! (top 5%) when they're clearly above the typical level (3 and 6 dB; no marks when the loudness hardly varies), with one line explaining them.
- **Measured with real Gemini** on Joe Rogan #2440 (144 min, medium): asked for 40, got 40 (before: 14); scores 90 down to 56, median 69; 16 lines marked !! and 127 ! of 1,088; 7 of the top 10 clips on loud lines, the top one the episode's loudest stretch (the Hunter S. Thompson dentist story). 43,441 tokens in (as before), 3,505 out (before about 1,000).
- Projects transcribed before this have no loudness: their clip searches work as before, just without the marks. "Find more clips" uses the new count.
- Verified: `npm run check` (175 unit tests; new: loudness per second from streamed samples, merging pieces, marks only where something stands out, the prompt's marks and wording, hype scoring, the new counts), build, default e2e (8); transcription of the test video saves its loudness, and a piece's lines up with the whole.

### Exports from followed streams came out empty (2026-10-03)

The user's export of a clip from a followed BobRoss (Twitch) stream downloaded as "1 KB", and the trim bar's filmstrip was black. The export had run while the stream was still being followed and wrote 262 bytes with no error.

- **Cause 1, seeking:** followed streams were recorded as fMP4 HLS. ffmpeg (5.1 and 7.0 alike) can't seek in an fMP4 playlist: with `-ss` before the input, past the first segment it reads nothing ("Invalid NAL unit size") and still exits 0. Exports and frames both seek, so exports were empty and frames failed (the black filmstrip, and no thumbnail). Reading from the start, a single segment with its init, and seeking after the input all worked, which is why playback and captions did. The live-stream tests marked their clip at 0:05, inside the first segment, and only checked that a Download link appeared. Fix: followed streams are recorded as MPEG-TS segments (`seg-NNNNNN.ts`, `video/mp2t`; hls.js plays them), in which ffmpeg seeks normally. fMP4 files from older follows are still served.
- **Cause 2, resolution changes:** found while testing on the live BobRoss stream: it switched from 1080p to 720p a few segments in, and the export's crop, sized for 1080p, failed on 720p frames ("Failed to configure input pad on crop"). Fix: `renderFilter` scales every frame to the recorded size before cropping (frames already that size pass through).
- **Safety nets:** `renderClip` probes the result and fails an export that came out without video or under half its length ("The export came out empty"), instead of offering it for download. `finishFollow` makes the thumbnail from the finished video if following never managed to.
- **Verified:** the live-stream follow test now waits for 50 s of stream, exports 0:30 to 0:45 mid-stream, downloads it and checks it with ffprobe (video, over 14 s). Passed on Twitch (bobross, through the resolution change) and YouTube (Sky News live, separate video and audio playlists). `npm run check` (169), build, default e2e (8).

### Referral links (2026-10-03)

The user asked for referral links: $5 to the referrer, once per subscription. Chosen with the user: the $5 is credit on the referrer's Bamio bill (Stripe customer balance), not cash (no Stripe Connect payouts, bank details or tax forms); it's earned after the friend's first payment that's more than $0 (so free signups and BAMIOFREE don't count); the friend gets nothing extra.

- **Links:** `/r/<code>` (8 characters without 0, 1, i, l, o), made on first use; sets a 60-day cookie and goes to the home page; kept out of robots.txt. Shown on Plan & billing (a "Refer a friend" panel with the link, Copy link, and friends subscribed, waiting, and $ earned) and as "Refer a friend" in the account menu (both only when plans are on).
- **Recording:** at checkout (`createCheckout`), from the cookie: only for a user who has never had a subscription, never their own code, the first referral only (migration 0005: `referral_codes`, `referrals` with pending → earned → credited).
- **Reward:** `settleReferral` when Stripe's `invoice.paid` arrives (new webhook event) and whenever Bamio saves a working subscription (so it works without webhooks): the first paid invoice with `amount_paid > 0` marks the referral earned once and emails the referrer in the same transaction ("You earned $5 on Bamio"); `creditReferrer` adds a −$5 Stripe balance transaction (idempotency key per friend). A referrer with no Stripe customer keeps it as "saved" until their first checkout, which credits it before the session opens.
- **Verified:** `npm run check` (169 unit tests; new `referrals.test.ts`: codes, recording rules, earning once only on a real payment, credit waiting for a referrer without a plan, nothing with plans off; the email template), build, e2e with `E2E_BILLING` (link sets the cookie, checkout records the referral, the panel shows the link), the default suite, responsive (billing on, all widths).
- **Not verified:** a real referred payment in live Stripe (would charge a real card); the Stripe calls are type-checked against the SDK and replaced by fakes in the tests.

### Live captures failed on the server (2026-10-03)

The user's Kick capture (myrongainesx) failed in 3 s with "Bamio couldn't record that stream", and the log had no reason. On the Droplet the npm ffmpeg-static build (7.0.2, johnvansickle, statically linked glibc) segfaults (exit 139, no output) as soon as it resolves a host name; ffprobe-static too. Local files work, so exports and uploads were fine, but every ffmpeg read of a URL failed: live captures, followed streams, Twitch VOD parts. Never seen on Windows. Fix: the image installs Debian's ffmpeg 5.1 (dynamically linked) and sets `FFMPEG_PATH`/`FFPROBE_PATH`. Checked on the server before switching: 10 s of the live Kick stream recorded (1080p H.264 + AAC), and an export-style render (blurred fill, x264, ASS captions with complex shaping: Devanagari conjuncts correct).

### SEO (2026-10-02)

The user asked for SEO "so every search engine recommends us on top". No one can promise rankings (they also depend on content and links from other sites, built over time); this pass gets every technical signal right, adds pages for what people search for, and gets the site to the search engines.

- **Before:** bamio.app had a title and description only: no robots.txt, sitemap, canonical addresses, link previews, structured data, favicon.ico or app icons (all 404), and every signed-in page could be indexed. Lighthouse (mobile, live): home performance 62 (LCP 7.6 s: the hero still waited behind the fonts and Clerk), SEO 100 for basic tags, accessibility and best practices 100.
- **Added:** `robots.ts` and `sitemap.ts`; per-page canonical, Open Graph and X cards (`pageMetadata` in `src/lib/site.ts`) with share images drawn from the design tokens (`src/lib/og.tsx`, every public page); JSON-LD (Organization, WebSite, SoftwareApplication with the six real prices, FAQPage, BreadcrumbList); `noindex` on sign-in and every signed-in page; favicon.ico, apple-icon, 192/512 PNG icons and a web manifest (`scripts/make-icons.mjs`); Search Console and Bing verification by env (`GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`); IndexNow (`npm run seo:indexnow`).
- **New pages** for searches: `/youtube-to-shorts`, `/podcast-clips`, `/twitch-clips`, `/auto-captions` (shared layout `components/site/use-case.tsx`: hero with the link field, a landing demo, three steps, six details, an FAQ, links to the others, the volt panel). Every claim on them was checked against the app (Hebrew font, per-clip captions toggle, Kick's 30 s history, 3-minute Shorts). Linked from a new "Made for" footer column on every public page.
- **Speed:** hero still `fetchpriority=high` and eager, other stills lazy, demo loops wait for the page's load event, Geist Mono not preloaded, `/landing/` cached a week. Measured after deploy below.
- **Copy:** home title "Bamio: AI clip maker for YouTube, Twitch and podcasts"; descriptions 149 to 173 characters. The hero headline ("clip the moments that hook.") stays as designed: the title and description carry the search words.
- **Search Console reported HTTP 525 on the sitemap** (Cloudflare failed the TLS handshake to the Droplet). The certificate was valid and fetches with a server name (IPv4 and IPv6, Googlebot and Bingbot user agents) returned 200, but a handshake without SNI failed. Fixed with `default_sni` in the Caddyfile (Caddy recreated alone, about a second of downtime); verified both ways.
- **Search Console page indexing (data to 2026-09-21, before this site):** 11 known addresses, none indexed: 7 404s and 4 server errors, probably an earlier site on the domain (the Wayback Machine has nothing for bamio.app; the exports don't list URLs). Found and fixed on the live site: `www.bamio.app` pointed at the Droplet but nothing answered (Caddy now redirects it, 301, keeping the path); `/login`, `/signin`, `/signup`, `/register`, `/home`, `/index.html`, `/plans` 404ed (now 308 to the real pages, `next.config.ts`). Still missing: `/privacy` and `/terms` (Google's OAuth consent screen and Stripe expect them).
- **Left for the user:** verify the domain in Google Search Console and Bing Webmaster Tools and submit the sitemap (web/DEPLOY.md, Search engines). Rankings then come from time, from links to bamio.app (launch posts, directories like Product Hunt and There's An AI For That, YouTube and TikTok videos made with Bamio), and from more pages answering real searches.
- Verified: `npm run check` (164 unit tests; new `seo.test.ts`: sitemap covers every public page and each has a share image, robots rules, metadata, structured data prices), build (webpack, while Smart App Control blocked Turbopack on this laptop), e2e (8 passed) and responsive (all pages incl. the four new ones, 320 to 1440).

### Fewer Gemini tokens (2026-10-02)

The user asked for the best clips with as few tokens as possible. Gemini only picks clips now (transcription is on the device), so the clip-finding prompt is where the tokens go; it was sending every caption phrase as `[754.3-758.9] text`.

- **Compact transcript:** phrases merged into lines of about 5 to 12 s ending at a sentence or a pause, numbered by their start second (`promptLines`). The model answers with line numbers; `clipTimes` maps them to exact phrase times and trims a clip that runs past 1.1 times the longest length at a line end, never mid-sentence. The prompt says line numbers are seconds, so the model can measure length.
- **Cache-friendly order:** transcript first, request last, so "Find more clips" on the same video reuses Gemini's implicit cache. Shorter schema descriptions; integer times; titles at most 60 characters, reasons at most 15 words.
- **Model defaults:** no temperature override (Gemini 3 is tuned for 1.0), thinking stays low, an output ceiling of 16k tokens so a runaway answer can't burn tokens. Every call logs tokens in, cached, thinking and out.
- **Measured** on the user's transcripts (countTokens): Joe Rogan #2440 (144 min) 94,115 to 42,985 tokens (54% fewer), #2219 (179 min) 123,681 to 52,351 (58%), the Nepali On Air with Sanjay (86 min) 36,517 to 18,726 (49%). Real runs: Rogan 43,138 in, 0 thinking, 1,036 out, 14 clips matching the old picks (the bank robber story behind The Town, the smugglers' planes, Spielberg's D-Day, psychedelics for veterans) with honest specific titles; Sanjay 18,879 in, 877 out, 12 clips, all 51 to 59 s for a 30 to 60 s request (the first run, before trimming, had four clips of 69 to 78 s).

### Promotion code BAMIOFREE (2026-10-02)

The user asked for a Stripe promo code giving 100% off, and chose: forever, code `BAMIOFREE`, at most 50 uses. Later the same day the user lowered it to 5 uses: Stripe can't edit a code's limit, so the 50-use code (unused) was switched off and `BAMIOFREE` created again on the same coupon with `max_redemptions` 5 (`promo_1UM8M5GkO4GRypZ9AdTO6hb6`). First created in the live Stripe account (coupon `Wx8957PM`, promotion code `promo_1UM3VpGkO4GRypZ943sMxrqn`; this API version takes `promotion[type]=coupon`, not `coupon`). Checkout now uses `payment_method_collection: "if_required"`, so a $0 checkout doesn't ask for a card; paid ones still do. Someone on the code is an ordinary active subscriber at $0 (plan emails, minutes, the billing portal all apply).

### Live at bamio.app (2026-10-02)

Production runs on the DigitalOcean Droplet (2 vCPU, 4 GB RAM after a resize, 77 GB disk, Ubuntu 24.04) from `/opt/bamio` (a git checkout; `web/compose.yaml`), behind Cloudflare's proxy, with Clerk production keys, Stripe and a Resend key. Updating: on the Droplet, `cd /opt/bamio && git pull && cd web && docker compose up -d --build`. Fixed on the first real Docker build: the image lacked `lbzip2`, so the speech models (`.tar.bz2`) couldn't unpack (`Dockerfile`). The models and caption fonts are downloaded, `/api/health` is ok, signed-out visitors go to `/sign-in`, and trashhpandaaaa@gmail.com has Pro (granted, Clerk production user). Since then: emails are on (`EMAIL_FROM` = Bamio <hello@bamio.app>; Resend has DKIM and SPF verified and accepted a test send, though it still lists the domain as partially verified), the live Stripe webhook to `/api/billing/webhook` is enabled with its secret on the server, and a cron job dumps the database daily at 03:00 to `/root/backups` (14 days kept; first dump made). Those dumps stay on the Droplet: switch on DigitalOcean's Droplet backups for a copy elsewhere. YouTube links: YouTube asked the Droplet to confirm it isn't a bot; the user chose cookies from a spare Google account (`YTDLP_COOKIES=/data/youtube-cookies.txt`, passed to every yt-dlp call; guide in DEPLOY.md). With them the server sees every format up to 1080p H.264, and the format choice keeps the original audio track (YouTube's auto-dubbed tracks are skipped). Re-export the cookies when the app log says they've expired.

### Free plans (2026-10-02)

The user asked to make trashhpandaaaa@gmail.com a permanent Pro user in the database. Rather than a fake Stripe subscription (Stripe syncing would overwrite it, and the billing page and portal would show a price and renewal that don't exist), a `plan_grants` table (migration 0004) holds plans given without paying, by Clerk user id. `allowance` in billing.ts takes the better of a grant and a paid plan (minutes, projects, queue priority, minutes emails); `/billing` shows a granted plan as "Free", "Given to your account, free of charge. It doesn't renew or end."; its minutes renew monthly from the day it was given. `npm run plan:grant -- <email> <starter|pro|team|none>` (or `-- --list`) finds the user in Clerk by email. Done in the local database for the user's development account (user_3JujTVhT5jdYZxhTD76750ogYh9); on the Droplet it has to be run there (`docker compose exec app node scripts/grant-plan.mjs trashhpandaaaa@gmail.com pro`), and again with production Clerk keys, whose users are different. Verified: unit test (grant gives Pro's minutes, projects and priority; a better paid plan wins; taking it back), e2e with `E2E_BILLING` (the billing page shows Free, importing works). Also fixed: the minutes panel said "-0 used" with nothing used.

### Hosting: one DigitalOcean Droplet (2026-10-02)

The user first deployed to Cloudflare Workers (OpenNext); the build failed bundling the AWS SDK, and Workers can't run Bamio anyway (no ffmpeg, yt-dlp or native speech engine, no long-running jobs, no disk). The user can't leave their PC on, and chose DigitalOcean. Decision: one Droplet with Docker Compose (`web/compose.yaml`): Caddy for HTTPS (`web/Caddyfile`, `DOMAIN` in `.env`), Postgres 18, and the app serving the site and running jobs, with media on the Droplet's disk (local storage; MinIO dropped from the compose file). Step by step in `web/DEPLOY.md` (Droplet size, DNS, Docker, swap, firewall, `.env`, models, Clerk production keys, Stripe webhook, Resend, updates, backups). Also: Clerk's sign-in and sign-up URLs are now set in code (`layout.tsx`, `proxy.ts`), since a Docker build only gets the publishable key and `NEXT_PUBLIC_` values are baked in at build time. Not yet run on a Droplet: the image has never been built (no Docker here).

### Emails through Resend (2026-10-02)

The user asked to "use resend api for email to notify users that they've been subscribed and other informations". Built:

- **What's sent** (`web/src/lib/email/templates.ts`): plan started ("Welcome to Bamio Pro"), plan changed, plan ending on a date (after cancelling) and continuing (cancellation undone), payment failed, plan ended; AI minutes at 80% and used up (once each per month and plan); a video or followed stream ready (with its 3 best AI clips and a link), and an import failed. Subjects and copy in Bamio's voice; HTML in the paper and night colours (inline styles, since mail apps ignore CSS variables; a test checks them against `tokens.css`), a plain-text copy, readable at 360 px. Screenshots and text in `web/qa/emails/`.
- **Turning emails off:** Profile → Notifications (`/profile/notifications`): "When a video is ready, or an import fails" and "When I've used most of my AI minutes" (the second only when plans are on), stored on the Clerk user (`unsafeMetadata.bamioNotifications`) beside the clip defaults. Plan and payment emails always go out.
- **How it works** (`web/src/lib/server/email.ts`, the only reader of `RESEND_API_KEY`): an outbox table (`emails`, migration 0003) with one row per user and key; plan emails are queued in the transaction that saves the plan (`updateBilling` got a `then` hook), so a webhook delivered twice, the billing page reading Stripe again, or a retried import never sends twice. Which plan change sends what is one pure function (`subscriptionNotices` in `billing.ts`). The mailer runs beside the job worker (web server or worker processes), is woken by NOTIFY, looks the user up in Clerk when it sends (primary address, settings), and sends with Resend's idempotency key; it retries when Resend or Clerk can't be reached (5 more tries over about 4.5 hours) and gives up on a refusal. Clerk test users (`+clerk_test` addresses) are never emailed.
- **Modes:** sent with `RESEND_API_KEY` + `EMAIL_FROM` (+ `BAMIO_APP_URL` in production, for links); `BAMIO_EMAIL=preview` writes and logs emails without sending (test servers use it, so a Resend key in `web/.env` never reaches a test user); `BAMIO_EMAIL=off` queues nothing. `/api/system/status` and `/api/health` say whether emails are on. `npm run email:check -- you@example.com` sends one test email.
- **Decisions:** no receipts (Stripe's own receipts are better: invoice numbers, tax); Stripe's failed-payment emails should be switched off so customers don't get two. Emails in English. No welcome email on sign-up (Clerk sends its own sign-up emails; a Clerk webhook would be needed). The "ready" email goes out for every import, even when the user watched it finish; it can be turned off.

### Verification (2026-10-02, emails)

- `npm run check`: 156 unit tests (16 new: every template renders, links point at `BAMIO_APP_URL`, no em dashes, escaping of video and clip titles, settings links only on emails that can be turned off, colours match the tokens; plan changes to emails, including a whole subscription's life through `saveSubscription` sending started, ending and ended once each; minutes at 80% and used up once each; the outbox sending once with an idempotency key, skipping turned-off emails and missing addresses and Clerk test users, retrying and giving up, taking over a stuck send, preview and off modes). `npm run build` and the worker bundle pass.
- End-to-end: the main test now checks that an upload's "Your clips are ready" email is written once (previewed) for the project.
- Emails rendered and screenshotted in light, dark and at 360 px (`web/qa/emails/`).
- Not verified: a real send through Resend (no key here, and the user's own address wasn't used). Run `npm run email:check -- <your address>` once the key and domain are set.

### The older logo back (2026-10-02)

The user asked to change the logo back to the older one, "with a rectangle rather than scissors". The i-dot of the wordmark is the 9:16 frame tilted 12° again, and so is the app icon (ink on volt), restored as they were before 2026-09-30 (`components/brand.tsx`, `app/globals.css`, `app/icon.svg`; `design/system/index.html` too). The Phosphor scissors icon stays where it labels clipping (Clip defaults, empty project lists): that’s a UI icon, not the logo.

### Real footage in the landing demos (2026-10-01, later)

The user asked for "real famous podcast and streaming clips" on the landing page. Famous creators' clips weren't used: their footage is copyrighted, and their faces on a paid product's page read as an endorsement (takedown and right-of-publicity risk). The user chose free stock footage instead.

- **Source:** Mixkit (Pexels and Pixabay refuse automated access from here; their APIs need a key). Mixkit Stock Video Free License: commercial use, no credit required (the landing footer credits it). #2948 "People recording a podcast in a studio" (two hosts with headphones and mics, one each side) and #43526 "Man playing an online video game on his computer" (a face cam). Gaming footage showing a recognizable game on screen was skipped (the game is someone else's copyright).
- **Files:** `web/scripts/landing-footage.mjs` downloads the 720p originals (in 1 MB ranges: Mixkit's CDN stalls on whole files here) and makes `web/public/landing/`: 960x540 silent loops (WebM VP9 about 0.5 MB and 0.2 MB, MP4 fallback), stills at a few seconds in, and a 10-frame filmstrip sprite. The loop cuts straight back to its start: a dissolve showed the two hosts twice.
- **Where:** the hero is now a podcast (YouTube, "Podcast, episode 112", three podcast-style clips, the filmstrip under it from the real frames); the moment finder and the live card use the face cam (they tell a stream's story); the caption studio and the language card use the podcast. 9:16 crops are made the same way as before (a window centred on each host, kept inside the frame), so the reframing story still shows.
- **Behaviour** (`components/landing/footage.tsx`): a still until the demo is on screen, then the loop plays from that still's second; videos off screen are removed; only the playing clip of the hero plays; reduced motion or data saving keeps stills. The drawn scene (`scene.tsx`) is gone.

### Plans and payments (2026-10-01)

The user asked for a payment system with Stripe and gave three plans: Starter ($12 a month, $30 for 3 months, 150 AI processing minutes), Pro ($24 / $60, 400 minutes, most popular) and Team ($54 / $144, 1,000 minutes), each with a feature list.

- **Catalog:** `web/src/lib/billing/plans.ts`, shared by the pricing page and the server. Prices in cents, minutes, projects kept, queue priority, and every feature line as given. **Features Bamio doesn't have are marked `soon` and shown under "Coming soon", never as included.** Included today: Starter's clipping, highlight detection, captions, 1080p, no watermark, 9:16, basic caption styles, 1 user, storage (50 projects), standard speed, support; Pro's 400 minutes, scores, AI titles, priority processing, extended storage (150 projects), commercial use, priority support; Team's 1,000 minutes, priority processing, increased storage (400 projects), commercial/client use, priority support. Coming soon: Starter's reframing, templates and brand; most of Pro and Team (4K, advanced clipping, hooks, B-roll, speakers, silence removal, caption styling, face tracking, scheduler, brands, extra users and team features, analytics, API).
- **What a plan does** (`web/src/lib/server/billing.ts`, the only reader of the Stripe keys): importing needs a working plan (active, trialing, or past due while Stripe retries). An import uses its length in AI minutes, counted once the video is prepared (a part uses only the part; uploads are checked in the browser before sending when it can read the length, and on the server once the length is known); a followed stream uses what gets captioned, and following stops when minutes run out. Minutes renew monthly on the subscription's anchor day (3-month plans too), and don't roll over. Up to a minute over is allowed. Finding more clips and transcribing again need a plan but use no minutes; editing and exporting are always free. Projects kept: 50 / 150 / 400. Pro and Team go first in every queue (`limiter.ts`: waiting work by priority, then order).
- **Stripe:** Checkout to buy (a Stripe customer per user, made at the first checkout, tagged with the Clerk id), the billing portal for everything after (upgrades now with the difference charged; downgrades and 3-month-to-monthly at period end; cancelling at period end), webhooks to keep `billing.json` current. Subscriptions are always re-read from Stripe, so events arriving out of order don't matter, and the server reads them again when the stored copy may be stale (a renewal due, half an hour old, or `/billing` opening), so it works without webhooks too. `npm run stripe:setup` creates products, prices (by lookup key, metadata kept when replaced) and the portal settings.
- **Without `STRIPE_SECRET_KEY`** nothing changes: no limits, `/pricing` shows the plans with a "payments aren't set up" notice, and the account menu has no Plan & billing.
- **Pages:** `/pricing` (the landing page's bar, footer and FAQ list are now shared components in `components/site/`; their links fold into the menu below 900px, since Pricing made the bar too wide at 768), `/billing`, a minutes line and a no-plan notice on `/new`, and "See plans" on imports stopped by the plan.

### Responsive pass (2026-10-01)

The user asked to make the UI "even more better and responsive". Every screen was measured instead of eyeballed:
- **Landing page:** 14 sizes, from 280 (Galaxy Fold) to 1920 plus a phone on its side (844 x 390), in both themes, with a script that checks sideways scroll, elements past the edge, text under 12px, tap targets under 24px, whether the hero's field is in the first screen, and heading line counts.
- **App screens:** a new opt-in test, `E2E_RESPONSIVE=1 npx playwright test responsive`. It uploads the sample video, then checks the import (link and upload tabs), projects, project, clip editor and clip defaults screens at 320, 390, 768, 1024 and 1440. All 35 combinations pass.

**Landing page changes:**
- **A menu on phones.** The section links used to vanish under 768px. Now a menu button opens a native popover (Escape, a tap outside or a link closes it). Under 360px, "Sign in" moves into it so the bar fits.
- **Panels lay out by their own width** (container queries), not the screen's:
  - The demo stacks below 1000px of its own width (it used to cram 60px-wide clips on an iPad), centred at 680px. On phones its clips become a row you swipe, each about half the width, so captions stay readable.
  - The language card shows one big phone with a swipeable row of language chips when narrow (three phones were about 100px each on a phone).
  - The mini editor keeps preview and controls side by side down to about 560px.
  - In "AI that finds the moment", the fixed-length cut marker is now its own row, with a shorter label when narrow (it spilled past the panel).
  - The link field drops its icon, then its button arrow, when tight, so the placeholder fits even in the closing panel on a 320px phone.
- **Fixes found by measuring:**
  - Grids whose implicit column grew to its content: the language card (its chip row was 470px on a 390px phone) and the editor.
  - Inputs that bring their own width of about 20 characters: the link field and the editor's start and end times. These now have a zero flex basis.
  - On a phone on its side, a tighter hero, so the link field is in the first screen.
- **Polish:**
  - Sections ease in as they scroll into view, using CSS scroll-driven animation: no script, and nothing with reduced motion or where unsupported.
  - FAQ answers open smoothly, where the browser can animate details.
  - Footer links are 30px tall, and the closing headline is smaller on small phones.

**App changes:**
- **The header** overflowed by 42px at 320 on every signed-in screen. Under 480px the three-way theme switch is one button that steps through the themes.
- **The clip editor:**
  - The phone preview takes 54% of the screen height (was 62%), so the trim bar is on screen with it.
  - The trim handles' boxes are 24px wide (32px on touch screens) while the bar you see stays 16px. The track is inset so they stay on screen.
  - The focus slider is 28px tall.

### Landing page after OpusClip, and scissors in the wordmark (2026-09-30, later)

The user asked to use https://www.opus.pro/ as a design reference while keeping Bamio's theme, and to put scissors in place of the dot on the i of the logo.

**Studied at opus.pro** (at 1440 and 390 wide; the screenshots stayed out of the repo): a dark page whose hero is the product's action (a large "Drop a video link" field with the button inside it, "or Upload files"). Right under it, a big demo of one long video turning into scored vertical clips for each platform. Then feature tabs, a creator and logo wall, and sections that each put a centered headline over a large rounded media panel with a product mock (the clip editor, reframing, a workflow). A "Drop a video link" bar stays pinned to the bottom while scrolling. Then testimonials, an FAQ accordion, a closing panel with the field again, and a big footer panel.

**Borrowed** (structure and reasoning, not their tokens, copy or assets; components in `web/src/components/landing/`):
- **The link field is the hero** (`LinkForm`): one pill holding the field and the button, links accepted without https://, errors under it. A valid link opens `/new?url=...` (Clerk sends signed-out visitors through sign-in and back), and the import page looks it up at once. "Upload a file" opens `/new?mode=upload`.
- **A product demo right under the hero** (`ClipFlow`): a stream on a studio set; a playhead scans its timeline and three moments land as vertical clips (a crop on each speaker and one "fit" framing), each with a score, playing its captions in turn.
- **Large dark panels with working product previews**:
  - `CaptionStudio`, a miniature clip editor: the caption style, position and title controls change the preview; the words follow along, and picking one jumps there; plus a trim bar and a play button.
  - Two cards, "Every language, detected" and "Clip live streams", with the words under the media. The language card shows Nepali mixed with English next to Hindi, Japanese, Arabic, Spanish and English.
- **A link bar that follows the page** (`StickyLinkBar`): it appears once the hero's field has scrolled away and hides again at the closing panel. It uses IntersectionObserver (no scroll listener) and is inert while hidden.
- **The ending**: an FAQ (native details, one open at a time), a closing panel with the field, and a footer panel (with the theme switch).

**"AI that finds the moment, not just a clip."** The user asked for this line (as "Ai that finds the moment, not just a clip"). It became a section right after the hero, set like the other headings (lowercase apart from "AI", highlighter on "not just a clip.", the line broken after "moment,"). Under it, `MomentFinder`:
- A stretch of a stream's transcript where a volt band marks the picked moment, from the line that hooks ("wait for it.") to the payoff ("nobody saw that coming."). The lines around it step back.
- A dashed line shows where a fixed-length cut would have ended the clip, mid-sentence: the "not just a clip" contrast.
- The clip it became: its title, score, times and the reason Bamio gives (the product shows a reason for each AI clip).

The band draws once when the section comes into view (at once with reduced motion). The bento's AI card now covers scores and reasons instead of repeating this, and the hero's first clip got the same length (0:17).

**Kept from Bamio (Hook):**
- Paper by default, with volt as the one accent. Anything showing video sits on a dark "studio" panel, so the page gets OpusClip's dark panels without leaving the theme. The whole page also works in the night theme.
- Lowercase display headlines with the highlighter, Bricolage and pill controls.
- The demos' captions use the export's spec (`lib/clips/ass.ts`), so they look like the real editor preview.

**Not borrowed:** eyebrow labels over every section, "#1" claims, and the feature tabs (the sections below cover the same ground). Also the creator and logo wall and the testimonials: Bamio has none to show, and none were invented.

**Decisions:**
- **Centered hero.** It's an exception to the taste skill's anti-center rule, because the reference's action-first hero is the point: the field is the design. The sections below stay left-aligned, with varied layouts (bento, split editor, two cards, split FAQ).
- **One action label everywhere:** "Get clips" (hero, bar, closing panel).
- **Drawn footage.** The demos show a two-person podcast set in headphones, lit by a volt sign. There's no image generator and no licensed footage; real clip frames would make the demos stronger.
- **Motion.** The demo's story plays once when it comes into view. Captions and the language cycle loop only while on screen, with pause buttons. With reduced motion, everything shows its finished state and the editor doesn't autoplay.
- **Footer fix.** The old line "Transcripts and clip picks by Google Gemini" had been wrong since on-device transcription. It now says Bamio transcribes and Google Gemini picks the clips.

**Scissors in the wordmark** (reverted 2026-10-02: the user asked for the older logo, the tilted 9:16 frame, back; the wordmark, app icon, design system page and docs use the frame again):
- The shape: two handle rings and two tapered blades, horizontal, with the blades forward and tilted 12° up (the angle the 9:16 frame had).
- Why this angle: upright scissors looked like a face at 27 px (the rings read as eyes), and diagonal ones blurred. Horizontal reads as ✂ down to 16 px.
- Implementation: one SVG path (`SCISSORS_PATH` in `components/brand.tsx`) in currentColor, 0.5 em wide over a dotless ı.
- The app icon is the same scissors, ink on volt. The AI mark and the playhead handle keep the 9:16 frame. The design system page (`design/system/index.html`) shows the new wordmark.

### English mixed with another language (2026-09-30, later)

The user sent a screenshot of "Fix caption words" on their Nepali project, lines mixing Nepali spelled in Latin letters, English and Devanagari: "It's not able to distinguish between nepali and english languages properly."

**What was found.** Their project ("On Air with Sanjay #809", 86 minutes, Nepali picked) is mostly English with Nepali sections: 1,103 of 1,316 caption phrases were in Latin letters. Picking Nepali sent all of it to Omnilingual, which writes English lowercase, unpunctuated and garbled ("i thinkoyou know", "texit you"). It also spelled some Nepali in Latin letters ("ma de porters snon zvede"), wrote some in Urdu or Oriya letters, and wrote English inside Nepali sentences as letter-level mixtures ("शhेs also नीeds to gिve मे the गreen light"). Separately, on a Nepali talk left on "Detect automatically", Whisper tiny said Malayalam, and the Indian-script repair then turned every Devanagari letter into Malayalam.

**What changed** (`workers/transcribe.mjs`, pure parts in `transcribe-core.mjs`):
- The Indian-script repair follows the script most of the transcript is in (60% or more), not the detected language.
- Detection listens at five points instead of three. The English model is used only when at least 70% of that is English; otherwise the multilingual or European model, whichever the other languages point to (`engineForWindows`). A detected language written in a different script from the transcript, or clearly outnumbered by another language's common words (Nepali, Hindi and Marathi; three Arabic-script and two Bengali-script languages), is renamed from the transcript (`languageForScript`). The worker names it again once 600 characters are transcribed, so the progress says "Transcribing Nepali", not Malayalam.
- **Repair pass** for Omnilingual transcripts (`repairMultilingual`), for every speech part not at least 70% in the language's script:
  - Parts with Latin letters are also transcribed by the English model (Parakeet v2). Where the two agree on at least half the words, and the part has almost nothing in the language's script, it's English: Parakeet's words, with capitals and punctuation.
  - Otherwise, runs of 3+ agreeing words are English inside the sentence (`englishSpans`). A word written half in each script counts as agreeing when its romanized spelling is close (`romanize`, edit distance 40% at most); a word wholly in Devanagari must match exactly, because Parakeet spells Nepali as English-like words ("Milara").
  - The rest is decoded again by Omnilingual after up to 8 s of the video's own speech in the language's script from just before it (from after it when there's none before, within a minute), keeping only the part's own tokens. That context keeps the model in the language. The result is used if at least 70% of it is in the script. Context on both sides did worse on the Nepali talk: an unclear 8 s stretch came out as fragments ("त्या ब् लत…") instead of "तयानि ब्लर हाल्दे ब्लरति हुन्छ…" (the talk is about blurring faces).
  - Clean-ups: `<unk>` markers dropped, vowel signs that would start a word dropped, and vowel signs after a virama or another vowel sign tidied (`tidyIndic`). These show as dotted circles in captions.
- "Transcribe again" now also appears on multilingual transcripts made before this change (`TRANSCRIBER_VERSION` 2 in `schema.ts`, `retranscribeReason`). Their word fixes are replaced, and the notice says so.

**Results:**
- The user's podcast, first 12 minutes, Nepali picked: 57 speech parts checked. 55 are now English with capitals and punctuation ("That's when everything is possible, you know. So you just have to keep the hope alive…", "I texted you because generally, bro…"). "ma de porters snon zvede" became "मैलै पढेर सुनाउछु हैन", and "तब असम्भव पनि सम्भव हुन्छ When we have hope," keeps both languages. Phrases with punctuation: 0 of 173 before, 172 of 228 after. The mixed sentence became "She's also need needs to give me the green light bunny. / तमानोक / packed my bag, I took the flight and I / even time and पुगरसिडाउन / sit down meeting Gorrego, / कनटेक्टहरु मिलारहइ who's the best person to be in touch with now." That's readable, but "bunny" and "Gorrego" are the English model's guesses at Nepali words inside English runs. The repair took 72 s on top of 408 s of decoding (18%) on a busy machine; the whole 12 minutes took 269 s on a quieter run.
- The Nepali talk (5 minutes, detect automatically) is named Nepali (was Malayalam) and is all Devanagari: 2,795 letters, none in another script (before, all of it was in Malayalam letters). Stretches in Urdu or Oriya letters were decoded again in Devanagari ("सुसाइड", "अलकति अब त्यो"), and "i mean like you you" became "I mean like you you have".
- An English clip on "Detect automatically" still goes to the English model, with the same output.

**Limits:**
- English said inside a Nepali sentence and written in Devanagari by the model stays in Devanagari ("आइ बलिभ" for "I believe"). Only stretches with Latin letters are checked against English.
- A speech part (up to 20 s) can hold both languages. When most of it agrees with English, all of it takes the English model's words, so its Nepali comes out as English-sounding words: garbled, as before, but in Latin letters.
- Omnilingual's Nepali itself agrees with YouTube's captions on 72% of characters (see Every language). The repair picks the script and the language, not the model's accuracy.

### Speed (2026-09-30)

The user asked to "make it run and work faster". Measured first (`tests/e2e/perf.spec.ts`, `E2E_PERF=1`: 20 minutes of a YouTube podcast imported as a part, mock AI, real transcription, on this 6-core laptop with 8 GB of RAM):

| Step | Before | After |
|---|---|---|
| Download the part | over 10 minutes (not finished) | 15 s |
| Prepare | 2 s | 2 s |
| Transcribe | about 150 s (estimated: the worker alone was 1.5x slower) | 78 to 100 s |
| Import in all | over 12 minutes | 95 s |
| Export one clip (45 s, 9:16) | 13 to 21 s | unchanged |
| Open a page (production server) | 0.6 to 4 s | same |

- **Parts were re-encoded, then throttled.** yt-dlp's `--force-keyframes-at-cuts` re-encoded the whole part just to cut on the exact second. Without it, a part is still read by ffmpeg over one connection, which YouTube throttles to about 2x real time. yt-dlp's own downloader gets whole files at 16 to 35 MB/s (ranged 10 MB requests), and parallel fragments (`formats=dashy -N 8`) were no faster: the connection is the limit. Now, where the files have a fragment index (YouTube H.264/AAC), only the header and the part's fragments are fetched (`dash.ts`: 8 MB ranged requests, four at a time, about 25 MB/s); otherwise the whole file is downloaded and cut locally when that's quicker, else yt-dlp cuts it. A part starts at the keyframe at or before the chosen start (up to a few seconds early), with video and audio kept in step (`-copyts`, one shared offset).
- **One lookup instead of three:** yt-dlp's answer from pasting the link is reused by the import (`--load-info-json`); a stale one is asked again.
- **Transcription:** `decodeAsync` lets several speech parts decode at once on one loaded model. On this laptop 4 parts with 2 threads each: English 21.5x real time instead of 13.1x, Omnilingual 1B 3.7 to 4x instead of 2.9x, identical output, same memory. The server sizes it by the CPU (`speechCpu`: two thirds of the machine) and raises the worker's libuv pool.
- **Checked and left:** hardware H.264 encoders (AMD AMF, Media Foundation) exported a 45 s clip in 11.5 s against 12.6 s with libx264 veryfast: decoding and scaling, not encoding, set the pace, so exports stay on libx264 (no driver dependency). `npm run dev` compiles each page on first visit; the production server (`npm run build`, `npm start`) opens pages in about a second.

### Following live streams (2026-09-30)

The user asked: "make the live stream video work without recording as well, add all the videos from start and be able to edit as the stream goes on." A live link now defaults to **Follow the stream**; "Capture a part" (the earlier rewind and record choices) is still there.

- **What it does:** capture the stream from as far back as it keeps, and keep adding to it until the stream ends, the user presses "Stop following", or 12 hours are captured. The project opens as soon as the first seconds are in (about 10 to 30 s), with a Live bar (captured so far, from where, captions so far, Stop following). Marking clips, the clip editor, AI clips and exports all work on what's in so far. When it ends, the rest is captioned and the project becomes a normal video (source.mp4) on the same timeline, so clips and edits carry over.
- **How far back:** Twitch uses its in-progress VOD, an EVENT playlist of the whole stream (checked: ironmouse's had been live 27 hours, 9,786 segments of 10 s), so following starts at the stream's start, up to 6 hours back (`LIMITS.maxFollowBackSec`, or `BAMIO_FOLLOW_MAX_BACK_SEC`). A 27-hour stream at 1080p60 would be about 70 GB, hence the limit. YouTube goes back as far as its rewind history (15 min to 1 h on the streams tested; the start when the stream is younger than that). Kick keeps about 30 s, so it follows from now. The import form says which, before starting.
- **How:** ffmpeg reads the stream's HLS and writes a growing HLS of 6 s fMP4 segments (EVENT playlist, `temp_file` so no half-written segment is ever listed) into the project's `live/` folder. Twitch audio needs `aac_adtstoasc` for MP4 segments. It downloads history at about 5x real time (1080p60), so 6 hours takes about an hour to fill in, oldest first, while the start is already editable. The browser plays it with hls.js (`/api/projects/[id]/live/...`, only three file-name patterns served). Frames, exports, captions and the final MP4 read a snapshot of the playlist closed with ENDLIST, so ffmpeg treats what's in so far as a finished video.
- **Captions while it grows:** pieces of up to 10 minutes once a minute of new video is in (the first piece detects the language), kept up to a pause at least 3 s clear of the edge of the piece so no word is cut (`commitPiece` in `lib/clips/live.ts`); the next piece starts inside that pause. The editor reloads the transcript as it reaches further, and says when a clip goes past the captioned part. AI clips are looked for every 40 minutes of new speech (Gemini's free tier allows about 20 requests a day) and at the end. Appending captions doesn't mark exports out of date.
- **Findings:** ffprobe-static is 4.0.2 and resolves a playlist's segment names against a backslash path wrongly ("Error when loading first segment"); snapshots use forward slashes. Tasks are now registered before they start: a project read in between saw the new follow as abandoned and began "finishing" it in parallel.
- **Limits:** a dropped connection ends following (what was captured is kept; start a new follow to carry on); following keeps source quality, about 2.7 GB an hour at 1080p60; after a server restart, what was captured is finished the next time the project is opened.

### Verification (2026-10-02, production architecture)

- `npm run check`: typecheck, lint, 140 unit tests in 12 files, run against a real Postgres (a separate `bamio_test` database, emptied and migrated before each run; the tests start the local database if it's down). New tests: storage on both drivers, with S3 through the s3rver emulator (publish, read, stat and download; serving with ranges, download names and the HLS proxy; uploads in parts; removing one object or a whole project; refusing unsafe keys). The queue (one live job per project, kind and clip; priority, then age; per-user caps; a stopped worker's job taken over; retries with growing waits; cancel and stop; jobs deleted with their project). The worker (slots, retries and permanent failures, time limits, cancel and stop, lease takeover, handing jobs back on shutdown). `npm run build` passes.
- End-to-end (default suite: upload, transcription on the device, mock AI clips, editing, a real export checked with ffprobe, deleting): passes three ways. With the web server running jobs itself. With `BAMIO_WORKER=off` and a separate `dist/worker.mjs`. And with `STORAGE_DRIVER=s3` against s3rver, where the upload, source, thumbnail, 14 filmstrip frames and the export all went to the bucket and were all removed with the project. `E2E_BILLING=1` passes with local storage and with S3. The responsive pages check passes (35 of 35).
- Crash test: worker A was killed (process ended) while transcribing an import; worker B claimed the job after its lease ran out (31 s), as attempt 2, skipped preparing (the video was already in storage) and finished with its clip.
- Not verified: the Docker image and Compose stack (Docker isn't installed here), real AWS S3 or R2 (only the s3rver emulator), following a live stream on the new architecture (the live-stream tests need live channels), and two web servers at once.
- Fixed along the way: `next build` ran out of memory on this machine (0xC0000409, "Zone Allocation failed"); `experimental.memoryBasedWorkersCount` sizes its workers to free memory. Imports failed when the scratch folder didn't exist yet. A graceful stop aborted the wrong job's controller.

### Verification (2026-10-01, plans and payments)

- `npm run check`: typecheck, lint, 115 unit tests (16 new: prices and savings as given, lookup keys, usage months incl. short months, the priority queue, subscription records, webhook signatures, plan gates with billing off and on). `npm run build` passes.
- E2E: `pricing.spec.ts` (plans, prices both ways, coming soon, payments-off state) passes with landing and screens; opt-in `E2E_BILLING=1` (test server with a fake Stripe key, plan written to the test user's files) passes: no plan blocks importing, checkout reports Stripe's refusal, out-of-minutes refused with "See plans", a Pro import counted (399 of 400 left), subscriber buttons (Your plan / Switch / Upgrade). The webhook route answered 400 to unsigned and forged events, 200 to signed ones it ignores, and an error (so Stripe retries) when it couldn't read the subscription.
- Responsive: the pages (landing, pricing, import, projects, plan & billing, clip defaults) pass at 320 to 1440.
- Not verified: a real Stripe account (no key here). `stripe:setup`'s calls were type-checked against the SDK, not run.
- During this pass Windows Smart App Control blocked the speech engine's DLL again, so the default suite's clipping test and the responsive project/editor check (both need transcription) couldn't pass; the import itself ran.
- Later the same day a Stripe key appeared in `web/.env` (the user's). Test servers now run with `BAMIO_BILLING=off` (or, for `E2E_BILLING`, a fake key that overrides it), so tests never reach a real Stripe account and the suite imports without a plan.
- Landing footage: the landing spec checks the hero's footage plays and that reduced motion gets stills only; landing, pricing, screens and the responsive pages check pass; `E2E_BILLING` passes. One `next build` crashed in a worker (0xC0000409) while generating static pages; the next three builds passed, so it looks environmental.

### Verification (2026-09-30, landing page and wordmark)

- `npm run check` passes (99 unit tests) and `npm run build` is clean. The default end-to-end suite passes (5 tests), including two new ones in `tests/e2e/landing.spec.ts`:
  - The hero's field shows errors for an empty field and for "not a link", then turns "youtube.com/watch?v=..." into the import page with the https link filled in and looked up. (The lookup is answered inside the test, so no site is contacted.)
  - The bar appears after the hero and hides at the closing panel, and "Upload a file" opens the upload tab.
  - Signed out, the field leads to sign-in with `/new?url=...` as the return address (checked by hand).
- Visual QA with Playwright: 1440, 768 and 390 wide, paper and night themes, and reduced motion. There's no horizontal scroll at any width: the demo's scanning layers and a text field's intrinsic width had caused some, now fixed. The console is clean.
- The scissors were compared at 12 to 96 px and in the wordmark at 22 to 72 px (paper and night). They read as scissors from about 16 px.

### Verification (2026-09-30, English mixed with another language)

- `npm run check` passes (99 unit tests; new: which model from several detection points, scripts of a transcript and of a language, naming the language from its common words, English agreement including mixed-script spellings, English runs, vowel-sign clean-up, when to offer "Transcribe again", and that the app and the worker agree on Parakeet's languages). `npm run build` is clean, and the default end-to-end suite passes.
- Worker runs on real audio: the user's podcast (12 minutes, Nepali picked), a Nepali talk (5 minutes, detect automatically) and the English test clip (detect automatically). The results are above.
- `E2E_LANGUAGES` (YouTube, detect automatically): Hindi passed. Japanese and Arabic were detected and transcribed correctly (all letters in their scripts), but the test paused the preview 2.5 s after the first caption, which in both videos fell in a pause between phrases with no caption on screen, and it then waited for a caption. The test now plays on until a caption shows and pauses on it, and Japanese and Arabic then pass. Spanish didn't get past the download: YouTube answered one of the part's byte ranges with 403, and the whole-file fallback was throttled (yt-dlp alone got 5 s of video in 39 s, 23 KB/s, with formats still listed, so not the bot check) until yt-dlp gave up. The European path is covered by the unit tests; rerun `E2E_LANGUAGES=es` when YouTube serves this connection normally again.

### Verification (2026-09-30, following)

- `npm run check` passes (88 unit tests, new: where following starts, which transcript phrases to keep near the live edge, finding the segment that holds a moment), `npm run build` is clean, the default end-to-end suite and the opt-in YouTube import pass.
- Live channels (`npx playwright test live-stream`, test server with `BAMIO_FOLLOW_MAX_BACK_SEC=300`), all six pass: for Twitch (ironmouse), YouTube (a 24/7 stream) and Kick (xqc), capture a part as before, and follow: the project opens within seconds and plays the growing video in the page and in the clip editor, the capture keeps growing, captions arrive while it grows (Twitch), a clip marked on it exports mid-stream, and after "Stop following" the project becomes a normal MP4 with the clip kept.
- Found on the way: Twitch's in-progress VOD had grown to 40 hours, and capturing a minute of it through yt-dlp's section download stalled for over 10 minutes. It's now read straight from the VOD's playlist with ffmpeg, from the segment that holds the chosen moment (1.2 minutes for the test, most of it waiting for Twitch). Playlist fetches retry on network errors (the 40-hour playlist is over a megabyte and once got a connection reset).

### Verification (2026-09-29, every language)

- `npm run check` passes (84 unit tests: word splitting in several scripts, character tokens, Indian script repair, which model per language, caption joining and widths, title lines, font runs and sizes, the preview's font CSS), `npm run build` is clean, and the default end-to-end suite passes (the English upload test now goes through automatic detection).
- `E2E_LANGUAGES=1`: 90 s of real YouTube videos in Hindi, Japanese, Arabic and Spanish, language left on "Detect automatically". Each was detected correctly, transcribed on the device in its own script, captioned in the editor with the export's font (checked with `document.fonts`), and exported with captions and a title. The preview screenshots and the exported frames (in `web/qa/languages/`) match: Devanagari conjuncts, Japanese in the JP font with the title broken into lines, Arabic right to left and joined, Spanish with capitals and punctuation.

### Verification (2026-09-29, live capture)

- `npm run check` passes (68 unit tests), `npm run build` is clean, and the default end-to-end suite passes (production build, mock AI), as does the opt-in YouTube import (`E2E_LIVE=1`).
- Live streams (`npx playwright test live-stream`, on channels that were live): each capture has to finish as "ready", have the expected length and sound, and play in the page. All pass:
  - Twitch (ironmouse): the last minute, from the in-progress VOD.
  - YouTube, the last minute from the rewind history, on two streams: one with separate video and audio playlists (15 min of rewind) and one whose video playlist carries its sound (Bloomberg, 1 h of rewind).
  - Kick (suspendas): record 1 minute and press "Stop recording now" after 20 s.

### Verification (2026-09-28)

- `npm run check`: typecheck, lint and unit tests pass (55 after the transcription change). `npm run build` is clean (no warnings).
- End-to-end (Playwright on Edge, production build, mock AI): signed-out protection; link validation; upload a generated 40 s video in two chunks, AI clips, a hand-marked clip, captions in the editor preview, edits persist after reload, **real ffmpeg export checked with ffprobe (1080 x 1080, with audio)**, range requests, out-of-date export, deleting a clip and the project. All pass.
- Live (opt-in, `E2E_LIVE=1`): a real YouTube link, part download (0:02 to 0:16), clip and export. Passes.
- Live Gemini (opt-in, `E2E_LIVE_AI=1`): a 58 s spoken track. The transcript was word-accurate, phrase times were within about 0.3 s of the real pauses, and two sensible clips were found ("What Nobody Tells You About Learning to Code", "The Real Secret to Learning Code"). Passes.
- `npm run ai:check`: JSON and audio input work on `gemini-3.8-flash` and on the `gemini-3.5-flash-lite` fallback (the main model was briefly at capacity for audio once; the fallback covers that).
- An exported frame was compared with the editor preview: same font, caption box, title box and proportions.

### Engineering decisions (v0.2)

| Decision | Why |
|---|---|
| Postgres for data and as the job queue (leases, retries, priority, NOTIFY); jobs run by worker pools in the web server or in separate worker processes (2 imports, 2 exports, 4 streams per process) | Durable work that survives crashes and scales out, without Redis: one less service, and jobs are queued in the same transaction as the change that asks for them. Needs long-running Node processes, not serverless. |
| Media in storage behind one interface: a local folder or S3 / R2 / MinIO, signed links stable per hour, work in progress in local scratch | Web servers and workers on different machines share media; the browser fetches large files from the store, not through Node. |
| yt-dlp for links (sha256-verified download via `npm run setup:media`), ffmpeg and ffprobe from npm packages; each can be overridden by env | Supports YouTube, Twitch, Kick and 1,000+ sites; nothing to install by hand. |
| Prefer H.264 / AAC up to 1080p when downloading; remux when possible, re-encode otherwise | Fast import, browser-playable source, good enough for 1080p exports. |
| Uploads in 8 MB chunks, resumable | Next.js buffers request bodies that pass through `proxy.ts` (10 MB limit); chunks also survive dropped connections. |
| Every language is transcribed on the device (sherpa-onnx: Parakeet for English and 24 European languages, Omnilingual ASR for the rest, Whisper tiny to detect the language), a time for every word; Gemini picks clips from the timed transcript | Gemini's timestamps drift by minutes on long audio (see Caption timing), and the free tier allows few requests. Gemini output is validated leniently (times as numbers or m:ss, overlaps fixed, clamped). |
| Caption fonts per script (Noto, downloaded and checked), chosen per character from recorded coverage, the same way in the preview and the export | Bricolage only has Latin; without this, other scripts render as boxes in the export or in a different font in the preview. |
| One caption spec shared by the preview (DOM) and the export (ASS): sizes, outlines, margins, the font's 1.56 em line height | What you see is what you export. |
| An export is marked out of date by a signature of the clip's times, look and transcript revision | Clear when a download no longer matches the edit. |
| Safety: signed-in user on every API route (except Stripe's signed webhook and the public health check), per-user keys with validated ids, cross-site writes refused, per-user rate limits, http(s) links only with private and loopback addresses refused (also after DNS lookup), an "only import videos you own or have permission to use" notice, basic security headers | The server downloads URLs and runs tools for users. |

### Open questions for the user

1. **Hosting.** Decided 2026-10-02: one DigitalOcean Droplet (see Hosting above). Earlier note: Bamio now runs as containers: web servers, media workers (CPU for transcription), a Postgres and an S3-compatible bucket. Not Vercel serverless. Which providers (for example Fly.io, Railway, Render or a VPS for the app; Neon, Supabase or RDS for Postgres; Cloudflare R2 or S3 for media)?
2. **Storage limits.** Projects stay until deleted (100 per user, 4 GB per upload, 3 hours per video). Should old projects expire automatically?
3. **Rights.** The app shows a permission notice. Is that enough for how you plan to offer it?
4. **Plans.** Choices made on the user's behalf, to confirm: coming-soon features are labelled rather than hidden; 3-month plans are subscriptions renewing every 3 months; AI on existing videos needs a plan but uses no minutes; plans keep 50 / 150 / 400 projects ("basic / extended / increased storage"); no free tier or trial; prices in USD, Stripe Tax off. Starter users also get clip scores and AI titles today (listed under Pro).

### Next steps

1. Payments: add a Stripe test key, run `npm run stripe:setup`, `stripe listen`, and buy, upgrade and cancel with test cards; then the live key and the production webhook (`npm run stripe:setup -- --webhook https://...`). Then build the coming-soon features in order of what sells (likely 4K export, silence and filler removal, face tracking / smart reframing, custom caption styling), removing each `soon` flag as it ships.
2. Imports: YouTube sometimes answers a part's byte range with 403 (twice now, the second time with the connection throttled to 23 KB/s), and the fallback then downloads the whole file. Find out whether the ranges need fresh URLs (retry the lookup once) and give a clearer message when YouTube throttles.
3. Transcription of mixed languages: English said inside a sentence of another language and written in that script ("आइ बलिभ") could be checked against English too (compare romanized words, as `wordAgreement` does for mixed-script words), and long speech parts could be split at the language switch instead of going wholly to one model.
4. Landing page: the demos have real (stock) footage now; next, a short real clip of Bamio's own export (captions burned in) somewhere on the page, and creators' clips only with their written permission.
5. Following live streams: carry on after a dropped connection (append to the same playlist), and choose a lower quality for very long streams.
6. Production, the rest of the checklist (the architecture is done; see Production architecture):
   - Deploy to the Droplet following `web/DEPLOY.md` (first real Docker build); later, for more capacity, R2 for media and separate worker Droplets.
   - Observability: error tracking (Sentry), structured logs, metrics and alerts on the health route's queue depth and failed jobs.
   - CI (check, build, e2e on every push), a staging environment, Postgres backups with point-in-time recovery, bucket versioning.
   - Clean-up: scratch folders left by failed jobs, projects past a retention period, per-user storage quotas.
   - Rate limits shared across web servers (in Postgres or Redis); today they're per process.
   - Account deletion (Clerk's user-deleted webhook removes the user's projects, media, billing record and emails), and the legal pages (terms, privacy, takedown).
7. Emails: verify the sending domain in Resend, set `RESEND_API_KEY`, `EMAIL_FROM` and `BAMIO_APP_URL`, run `npm run email:check`, then buy a test plan to see the welcome email arrive. Switch off Stripe's failed-payment emails. Later: a welcome email on sign-up (Clerk webhook), and a one-click unsubscribe header if Bamio ever sends marketing email.
8. Possible upgrades: punctuation and capitals for languages Omnilingual writes without them (a punctuation model, or Omnilingual's LLM variant when sherpa-onnx supports it), speaker-aware auto-reframe (face tracking), batch export as a zip, more caption styles and fonts, keyword highlights, background music, direct posting to TikTok and YouTube.
9. Keep yt-dlp current (`npm run setup:media`); sites change often.
10. Responsive checks are automated now (`E2E_RESPONSIVE=1`); still to do: a look at real projects (long titles, many clips, live streams) in both themes with a live Gemini key.

## Previous engineering phase (v0.1, superseded 2026-09-27)

**Engineering: Bamio web app v0.1 was built in `web/` (Next.js 16 + Gemini) as an idea-to-video tool.**

On 2026-09-26 the user asked to move from design to building with Next.js and the Gemini API. Phases C to K were therefore designed directly in code, on the Phase B design system, rather than as separate static comps.

### Engineering status (web app v0.1, since removed)

| Area | Status |
|---|---|
| Landing page (`/`) | Built. Hero uses the real renderer as a live demo. |
| Dashboard (`/projects`) | Built. Cards, template quick-starts, duplicate, delete with confirm, empty and loading states. |
| Create project + AI story builder (`/new`) | Built. Templates, brief, 3 AI hooks or write your own, AI script. Works without AI ("Write it myself"). |
| Storyboard | Built. Per-scene caption, voice-over, picture prompt, shot, length; make, upload, drop or remove pictures; record voice-over; reorder, duplicate, delete. |
| Video editor | Built. Live canvas preview, transport, multi-track timeline with scrubbing (slider, keyboard), inspector, caption styles, cut or fade, voice. |
| AI director | Built. Notes with one-click apply or dismiss. |
| Templates | Built as 6 formats that shape the AI script (product launch, quick tips, day in the life, recipe, before and after, story time). |
| Export and rendering | Built. Real-time 1080 x 1920 MP4 (WebM fallback) with the voice-over mix; verified by decoding frames from the exported file. |
| Responsive | Checked at 390 and 1440 on every screen: no horizontal overflow; editor fits a 1440 x 900 laptop. |
| Tests | 36 unit tests (Vitest) and 7 end-to-end tests (Playwright, mock AI), all passing; typecheck, lint and production build clean. |
| Live Gemini | **Not yet verified** (no key on this machine). Run `cd web && npm run ai:check` after adding `GEMINI_API_KEY`. |

### Engineering decisions (v0.1)

| Decision | Why |
|---|---|
| Next.js 16 App Router, TypeScript strict (plus `noUncheckedIndexedAccess`), plain CSS with the design-system tokens (no Tailwind) | The design system already exists as CSS variables; no second styling system. |
| Gemini via `@google/genai` `models.generateContent`; models configurable by env: text `gemini-3.8-flash`, voice `gemini-3.8-flash-tts`, image `gemini-3.1-flash-image` | IDs taken from the current Gemini docs and pricing page (2026-09); configurable because IDs change. |
| Key server-side only (`server-only` modules); routes validate with zod, cap body size, reject cross-site origins | Protects the key and quota. |
| All model output validated leniently and retried once on bad JSON | The app must not break on odd model output. |
| Local-first: projects and media in IndexedDB; no accounts or backend DB | Fastest path to a working product; nothing uploaded except text to Gemini. |
| One canvas renderer for preview and export; export via MediaRecorder in real time | Preview is exactly what you export; no server rendering infrastructure. |
| Scenes without a picture render as brand text cards (volt / ink / paper) | Image generation has no free tier; the video still looks designed. |
| Mock AI mode (`BAMIO_AI_MOCK=1`) | Deterministic tests and demos without a key. |

### Known limitations at the time (v0.1)

1. **Verify live Gemini** with the user's key (`npm run ai:check`, then one full video). Adjust prompts from real output.
2. **Not deployable publicly yet:** no sign-in and no rate limiting on AI routes. Add auth, per-user rate limits and server storage before any public deploy.
3. Export is real time and needs the tab visible; a faster WebCodecs encoder is a possible upgrade.
4. Possible upgrades: background music (licensed), Veo video clips per scene, sync across devices, sharing links.
5. Trademark and domain search for "Bamio" is still not done.

## Design phase tracker

| Phase | Name | Status |
|---|---|---|
| 0 | Design tool setup | Done (see `DESIGN_TOOLS.md`) |
| A | Brand exploration | Done. Direction 2 (Hook) chosen 2026-09-26 |
| B | Bamio design system | Done |
| C to K | Landing, dashboard, create, story builder, storyboard, editor, director, templates, export | Built directly in code (see Engineering status) |
| L | Responsive design | Done 2026-10-01: every screen at 320, 390, 768, 1024 and 1440 (`E2E_RESPONSIVE=1`), the landing page at 14 sizes from 280 to 1920 and a phone on its side |
| M | Final visual QA | Partly done during engineering; a full pass with a live key is still to do |

## Completed screens

| Screen | File | QA |
|---|---|---|
| Brand exploration (3 directions) | `design/phase-a-brand/index.html` | 390, 768, 1440; guideline audit passed. Screens in `design/phase-a-brand/qa/`. Historical now that Hook is chosen. |
| Design system spec (tokens, rules, all components, studio primitives, voice) | `design/system/index.html` | Paper and night themes at 1440; paper at 390; no horizontal overflow; all images, fonts (Bricolage, Geist Mono) and icons (Phosphor regular and fill) load; console clean; theme toggle switches, persists and updates `theme-color`; skip link and focus outline checked by keyboard; guideline scan clean after fixes. Screens in `design/system/qa/`. |

To view: `python -m http.server 5178 --bind 127.0.0.1 --directory design` from the project root, then open http://127.0.0.1:5178/system/index.html. Run Playwright from the project root too (see `DESIGN_TOOLS.md`).

## App screens

Built in `web/` (see Current phase above). Run `cd web && npm run dev`.

---

## Brand foundation (from Phase A, locked)

- **Name:** Bamio. "Bam" = impact, the clap of a slate, the first second. "-io" echoes studio, audio, radio. Lean on the studio meaning, not the tech ".io" one. (The folder on disk is still called `Bamie`.)
- **What Bamio is (since 2026-09-27):** a clipping and editing tool that turns long videos (YouTube, Twitch, Kick, other sites, uploads) into vertical shorts with AI-picked moments and word-by-word captions. (Originally an AI idea-to-video studio.)
- **Direction: Hook.** Short-form is won in the first second. Creator-native energy, light paper marketing, volt accent, Bricolage Grotesque, lowercase wordmark whose i-dot is a 9:16 frame tilted 12° (scissors from 2026-09-30 to 2026-10-02, then back to the frame at the user’s request), pill controls, casual second-person voice. Tagline: "Make the first second count."
- **Audience (assumed, needs the user's confirmation):** solo creators and social teams first, agencies and brand teams second.
- **Non-negotiables:** video surfaces are neutral dark; 9:16 is the native canvas; one accent, locked; no AI clichés (no purple glow, no sparkles); sentence case, concrete verbs, no em dashes; WCAG AA everywhere.
- Phase A's full reasoning, the rejected directions and the comparison are in `design/phase-a-brand/index.html`.

## Phase B: what exists

### Files (the source of truth for every later phase)

| File | Contents |
|---|---|
| `design/system/tokens.css` | Every value as a CSS custom property: brand colors, paper and night theme tokens, status colors, type scale (as `font` shorthands), 4px spacing scale, radius, shadows, motion durations and easings, z-index layers, layout sizes. Includes reduced-motion overrides and `prefers-color-scheme` handling. |
| `design/system/components.css` | Base styles, type utilities, highlighter, AI mark, buttons, fields, prompt, checkbox, radio, switch, chips, segmented control, tabs, menu, tooltip, toast, dialog, badge, kbd, avatar, project card, empty state, skeleton, progress, and studio primitives (player, caption, transport, timecode, timeline, track, clip types, playhead). |
| `design/system/index.html` | Living spec page. Imports both files plus Google Fonts and Phosphor from CDNs. |

Later comps link `../system/tokens.css` and `../system/components.css` and add only page-specific CSS.

### Key decisions

| Decision | Why |
|---|---|
| **Three theme contexts.** Paper (light, default), Night (dark app chrome), and Studio (class `.studio`), which forces night tokens on any surface that shows video. Theme is set by `data-theme` on `<html>`, falling back to the system preference. | Honours "video sits on night" while letting marketing and app chrome be light. |
| **Volt's one job:** what is live, what is selected, and the single most important action per screen. Never status, never decoration, never text on paper. | Keeps Hook from reading as a loud template app. Volt on paper is 1.2:1. |
| **On paper, volt fills always carry a 1.5px ink edge** (`--volt-edge`). On night the edge is transparent. | Gives the button a visible edge (volt vs paper fails 3:1) and matches the sticker look from Phase A. |
| **`--mark` token:** ink on paper, volt on night. Used for playhead, progress fill, selected-tab line. | One name for "strongest indicator" that is always accessible. |
| **Primary button is ink** (light on night); the volt button is reserved for one hero action per screen. | Discipline. |
| **Control edges use `--line-control`** (`#8B8B84` paper, `#6E6E6E` night, 3:1 or more); `--line` is for decorative dividers only. | WCAG 1.4.11 non-text contrast. |
| **Status colors** kept far from volt's hue (72): success emerald (148), warning burnt orange (26), error red, info blue. Each has paper and night values, all 4.5:1 or more. Status always pairs color with an icon and words. | A status must never be mistaken for the brand. |
| **Dark neutrals are pure greys** (`#0E0E0E` to `#EDEDED`); paper neutrals carry a very slight warmth. | Untinted surroundings for footage. |
| **Type:** Bricolage Grotesque for everything with optical sizing on; Geist Mono only for numbers that must align (timecode, sizes, percentages). Lowercase display for marketing, sentence case in the product. | Judged readable at 12 to 14px in both themes. Revisit if dense editor panels feel noisy (see open issues). |
| **Sentence case** for headings and buttons. | Confirmed (overrides the Vercel guideline's Title Case rule, as planned in `DESIGN_TOOLS.md`). |
| **Shape rule:** single-line controls are pills; multi-line fields and menus 16px; cards and panels 22px; dialogs 28px; large video frames 18px; thumbnails 96px or smaller 6px. Avatars are rounded squares, not circles. | One documented radius system (Taste shape lock). |
| **Focus:** one style everywhere, 2px outline in `--focus` (ink on paper, volt on night) with 2px offset. | Consistent and 3:1 or more in both themes. |
| **Motion:** 80, 140, 220, 360, 560ms; ease-out to enter, ease-in to leave; `--ease-pop` overshoot only for caption words and confirmations. Reduced motion collapses durations to 1ms. | "Quick and springy, never floaty." |
| **Icons:** Phosphor, regular weight (20px in controls, 24px alone); fill weight marks active states. No hand-drawn icons. | Taste skill ranks Phosphor first. |
| **AI mark:** Bamio's 9:16 frame, tilted 12° (the wordmark's i-dot), labels AI work, always next to a verb ("Hook suggested by Bamio"). No sparkle icon. | Ownable and honest. |
| **Playhead handle is an upright 9:16 frame.** Selected clips get a volt outline. Captions highlight the spoken word in volt. | Brings the brand motif into the editor. |

### QA fixes made during Phase B

- Tooltip and segmented control stretched in grid layouts: now `justify-self: start` by default.
- Overlay panel was too narrow for toasts: changed to a 7:5 split.
- Studio timeline panel stretched to the player's height: aligned to start.
- Filled Phosphor icons (`ph-fill`) missed styles written for `.ph`: component selectors now target the `i` element.
- Prompt textarea removed its outline: the container now shows the standard focus outline.

## Open design questions (from Phase B)

1. **Does the design system look right?** Anything to change before it is used on every screen.
2. **Confirm the audience:** solo creators, streamers and social teams first?
3. **Dark mode for the app chrome:** the system supports both. Should the dashboard default to paper (light) or follow the device?

## Other open issues

- No trademark, domain or app-store name search has been done for "Bamio" or the wordmark.
- The standalone icon (tilted frame alone, ink on volt) could read as a generic phone shape. It was the scissors from 2026-09-30; on 2026-10-02 the user asked for the frame back, in the wordmark and the icon.
- Bricolage in dense panels: now used in the clip editor inspector and reads fine at 12 to 14px; keep an eye on it.

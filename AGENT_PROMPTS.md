# Bamio agent prompts

## 0. How to use this pack

For the person driving an AI coding agent (Claude Code, Cursor, Codex or similar) on the Bamio repository.

How a session works:

1. One roadmap item per session, with fresh context (Phase 1 item 8 is four sessions, one per 2.4 bullet; the section 3 example is the first). When `ROADMAP.md` marks an item L, split it along the steps the roadmap gives and run one step per session; publishing is one session per platform.
2. Paste the operating prompt (section 1) first, then a phase prompt from section 2 with the line "This session: item N", a filled section 3 template, or a section 4 prompt. End with "Start with the plan."
3. Review every session with section 5 before merging. When a script, flag or file named here is renamed, change the pack in the same commit.

What you do yourself (the agent must not try; it lists these under "Needs from you"):

- Keys and secrets: `GEMINI_API_KEY`, the Clerk keys, `STRIPE_SECRET_KEY`, `RESEND_API_KEY` and the rest of `web/.env` (never committed), the Droplet's `.env`, GitHub Actions secrets.
- Registrations: Stripe products (`npm run stripe:setup`), the Resend domain, the Clerk production instance and its webhooks, the YouTube, TikTok and Instagram developer apps (reviews take weeks; apply during Phase 1).
- DNS, the Droplet (SSH, resize, `docker compose` on the box), the backup bucket and the restore test.
- Decisions: the free tier, refunds, every company fact in a legal page; the lawyer's review of `/terms`, `/privacy` and `/takedown`.
- Live channels for `E2E_LIVE_TWITCH`, `E2E_LIVE_YOUTUBE` and `E2E_LIVE_KICK`, Stripe test-mode checkouts, `npm run email:check -- you@example.com`, real Gemini runs.

Your machine. Tests run on Windows against Edge (`channel: process.env.E2E_CHANNEL ?? "msedge"` in `web/playwright.config.ts`). In PowerShell a flag is set as `$env:E2E_RESPONSIVE="1"; npx playwright test responsive`. If a dev server is already running, use the production-build route at the end of the Scripts section in `web/README.md`.

Tools that do not load `CLAUDE.md` on their own (Cursor, Codex, most others): put this line above the operating prompt: "Before anything else, read `CLAUDE.md` at the repository root, `web/AGENTS.md` and `web/README.md` in full and follow them."

## 1. The operating prompt

You are working on Bamio, which turns long videos into captioned vertical shorts (the Next.js 16 app in `web/`). This session you build one roadmap item, to the standard of the product in `ROADMAP.md` section 4: it must work for a paying stranger, in every language, on a phone.

Read first, in this order: `CLAUDE.md` at the repository root and `web/AGENTS.md`; `DESIGN_TOOLS.md` when the item changes a screen; `DESIGN_STATUS.md`, the first 60 lines and "### Next steps"; `ROADMAP.md` section 6, the section your item is in, its section 5 row and its section 7 metric; `web/README.md`; the files your item touches and their tests in `web/tests/unit` and `web/tests/e2e`; for any Next.js API, `web/node_modules/next/dist/docs/`.

Plan before code, at most 15 lines: the item's number and title; the user-visible outcome; files to touch, with the function in each; tests to add or change, by file; the acceptance checks a reviewer can run; what you need from the human; one question, only if its answer changes the work materially.

Non-negotiables, each a `CLAUDE.md` sentence you can grep for: "The Gemini key stays server-side"; "Every Gemini response is validated with zod"; "A project is one zod-validated jsonb document"; "Background work is a job" (`mutateProject`, `enqueue`, never a handler called from a route); "Media goes through `storage()`"; "The design system lives in"; "Change the schema only with a new numbered file"; "Any runtime path under `process.cwd()`"; "share sizes and margins. Change them together" and "Other scripts use Noto fonts chosen per character"; "Every API route goes through `userRoute`" (its two exceptions are named there; a third changes that sentence in the same commit); "Never build a file path or storage key from user input"; "New AI work goes through its gates" and "anything that reads the plan must go through it"; "never pay out cash, never reward a $0 checkout"; "Never send from a route or a job directly"; "anything that reads the video must go through `withSourceFile`"; "Every admin page calls `requireAdmin()`"; "a new public page goes in `USE_CASES`". Bamio's voice everywhere: plain, concrete, second person, sentence case, no em dashes.

Safety rules on top. Migrations only add (never drop or rename), carry the reverse statement in a top comment, and are tested on an empty database and, by the human, on a production `pg_dump` restored into a scratch database on the Droplet (prompt 4.5), never copied off the box. Say what happens to a job running at deploy time. No change to `web/compose.yaml`, `Dockerfile` or `Caddyfile` without a rollback line in `web/DEPLOY.md`.

Verification ladder, from `web/`.

1. Always: `npm run check`, `npm run build`, `npm run test:e2e`.
2. UI changed: `E2E_RESPONSIVE=1 npx playwright test responsive`, then read `qa/responsive/report-*.json`.
3. `highlightPrompt`, `promptLines`, `clipTarget` or `hypeScore` in `src/lib/ai/server/clips-ai.ts` changed: prompt 4.1.
4. `workers/transcribe.mjs`, `transcribe-core.mjs` or `speech-models.mjs` changed: real code-mixed audio and `E2E_LANGUAGES=1`; bump `TRANSCRIBER_VERSION` when worth re-transcribing for.
5. `storage.ts`, `store.ts`, `live-media.ts` or anything that writes media changed: `tests/unit/storage.test.ts`, then e2e with `STORAGE_DRIVER=s3` against s3rver as `CLAUDE.md` describes.
6. Anything that hands ffmpeg or yt-dlp a URL: the Droplet, run by the human, or "Not verified" with the exact commands.
7. Billing: `E2E_BILLING=1`. Admin: `E2E_ADMIN=1`. Real link imports: `E2E_LIVE=1`. Live streams: `npx playwright test live-stream`.

Done means all of: a unit test for every new pure function and an e2e step for every new screen or action; `web/README.md` rows for new scripts, settings and flags, `web/DEPLOY.md` for anything an operator does; a dated `### <Title> (<date>)` entry under "## Current phase" in `DESIGN_STATUS.md`, its "Last updated" line moved; the feature's `soon` line removed in `web/src/lib/billing/plans.ts` when, and only when, it works end to end; a new `web/db/migrations/000N_<name>.sql` for any schema change.

Scope. One item. No refactors or reformatting outside the files in your plan; `git diff --stat` matches the plan or the report explains every extra file. No new dependency without one line saying why nothing in `package.json` does the job. No new `NEXT_PUBLIC_` setting. A bug outside the item goes under "Left". Work on a branch named after the item; commit only when the human asks; never force push.

Report, with exactly these headings: **Changed**, **Commands run** (pasted output tails), **Not verified** (what, why, commands for the human), **Left**, **Risks** (what breaks in production and what undoes it, with the rollback line for any change to `compose.yaml`, `Dockerfile` or `Caddyfile`), **Needs from you**.

Forbidden: `.only`; `.skip` other than the suite's opt-in gate at the top of a spec (`test.skip(!process.env.E2E_X, ...)`); loosening an assertion or raising a timeout to pass; a real `STRIPE_SECRET_KEY` or `RESEND_API_KEY` on a test server (`BAMIO_BILLING=off` or `STRIPE_SECRET_KEY=sk_test_e2e_fake`, and `BAMIO_EMAIL=preview`); email sent from a test; `git push --force`; a secret in client code or a log line; an invented company fact in legal text; deleting production data by hand; "done" about a command you did not run in this session.

## 2. Phase prompts

Paste a phase prompt after the operating prompt, then "This session: item N". The agent confirms the number and title in its plan and does that one item only. Detail is in the `ROADMAP.md` sections in brackets.

### Phase 1: make it safe to sell

Goal: nothing is lost on a disk failure or a deploy, someone is told when Bamio breaks, and the legal and account basics exist.

Items, in order:

1. Off-box backups and a tested restore [2.3]. Nightly `pg_dump` to an S3 or R2 bucket, and the media: `/data/media` is inside the `app` container on the `appdata` volume (`docker volume inspect web_appdata` gives the host path; `docker compose exec app tar -C /data -c media` streams it out). Check: `DEPLOY.md` holds the restore commands and the date of a rehearsed restore into a scratch database. Nothing else starts before this is done.
2. CI [2.3, 2.5]. `.github/workflows/ci.yml` on every push: `npm run check`, `npm run build`, `docker build`, then the e2e suite with `E2E_CHANNEL=chromium` on the runner against the built image as a container on port 3100 (`BAMIO_AI_MOCK=1 BAMIO_BILLING=off BAMIO_EMAIL=preview`, the Clerk keys, and a Postgres service the runner's `DATABASE_URL` also reaches, since `clips.spec.ts` reads the `emails` table; the image has no dev dependencies or browsers, and Playwright finds the server through `reuseExistingServer`); `npm audit --omit=dev`; gitleaks; `.models` cached between runs. Check: green on `main`; a failing test, or a committed key in a real provider format (`sk_test_` plus 24 letters and digits), turns it red; `sk_test_e2e_fake` in `web/playwright.config.ts` stays, allow-listed in `.gitleaks.toml` if a rule matches it.
3. Images from CI [2.3, 3.7]. CI pushes `ghcr.io/trashhpandaaaa/bamio:<sha>`; `compose.yaml` pulls `image:` `${BAMIO_IMAGE_TAG}` instead of `build:`; `DEPLOY.md` runs `docker compose run --rm app node scripts/db-migrate.mjs` before `up -d`, so a failed migration stops the deploy. Check: one deploy with no build on the Droplet; rollback `BAMIO_IMAGE_TAG=<previous sha> docker compose up -d`.
4. Split web and worker [2.3, 3.1]. `app` with `BAMIO_WORKER=off`; a `worker` service from the same image with its own healthcheck (the Dockerfile's expects port 3000). `DEPLOY.md`: `docker compose up -d --no-deps app` keeps followed streams running; deploy `worker` when `/admin/jobs` shows no running follow. Check: `app` healthy, `worker` claiming jobs; `/api/health` answers under 1 s during an import.
5. Alerts and logs [2.3]. Sentry in web and worker, server-side only (`SENTRY_DSN` read in `src/lib/server`, no `NEXT_PUBLIC_` DSN); an uptime check on `/api/health`; the four alerts 2.3 lists; JSON log lines with a request id, `projectId` and job id. Check: each alert fired once on purpose; `docker compose logs app | grep <projectId>` finds a failed import.
6. HSTS and CSP [2.5]. HSTS in `Caddyfile`; a report-only CSP set per request in `src/proxy.ts` (or a `header` directive in `Caddyfile`), not in `next.config.ts`, whose `headers()` are fixed at `next build`, where the Docker build has no `.env`; it allows Clerk, Stripe and, with `STORAGE_DRIVER=s3`, `S3_PUBLIC_ENDPOINT` (production is `local` today), reporting to Sentry. Check: `curl -I https://bamio.app` shows both; the e2e suite and one real checkout produce no reports.
7. Egress rules [2.5]. yt-dlp and ffmpeg, started by the worker, cannot reach private, link-local or metadata ranges (a small forward proxy through `--proxy` and `http_proxy`, or rules keyed on their uid); Node still reaches Postgres and the S3 endpoint. Check: a link redirecting to `http://postgres:5432` or `169.254.169.254` fails with a clear error; nothing is fetched.
8. Sweepers [2.4], all four, on the `pruneJobs` timer in `worker.ts`, one session per bullet. The orphan sweeper deletes a prefix only when no project row exists on two passes an hour apart and its newest object is over 24 hours old; `BAMIO_SWEEP_DRY_RUN=1` only logs, and production runs so for a week first (`DEPLOY.md`). Check: a unit test per sweeper in `tests/unit/worker.test.ts`, among them "keeps the folder of a running job" and "keeps the prefix of a project created during the listing".
9. Inspect cap [2.5]. `limiter(4)` around `inspectUrl`, a short negative cache. Check: a unit test shows 10 parallel lookups run 4 at a time.
10. yt-dlp pinned [2.5] by version and SHA-256 in `scripts/setup-media.mjs`, bumps gated on `E2E_LIVE=1`. Check: `npm run setup:media` prints the version.
11. Upload parts outside the lock [2.5]. The upload route uploads the part, then records it inside `mutateProject`. Check: a duplicate part is harmless in a unit test; an opt-in `E2E_UPLOAD_LARGE=1` test uploads a 100 MB file made with ffmpeg (`-f lavfi testsrc`) on both drivers.
12. Legal pages [2.2], with prompt 4.4. Check: `/terms`, `/privacy` and `/takedown` in the sitemap and a legal footer group (`site-chrome.tsx`), each with `pageMetadata` and an `opengraph-image.tsx`; `tests/unit/seo.test.ts` passes; the branch waits for the lawyer.
13. Account deletion [2.2]. A Clerk `user.deleted` webhook route (`verifyWebhook` from `@clerk/nextjs/webhooks` over the raw request, no `svix` dependency, no session: a new exception to CLAUDE.md's "Every API route goes through `userRoute`" sentence, changed in the same commit, with the comment in `src/proxy.ts`) removing everything 2.2 lists; "Delete my account" and a data export on `/profile`. Check: a unit test with a signed and an unsigned payload; a throwaway `+clerk_test` user made for the test (never the suite's `bamio-e2e+clerk_test@example.com`) is deleted and leaves no rows and no storage prefix.
14. Support [2.1]: a support address in the footer and account menu; "Report a problem" on a failed import opens a mail draft holding the project id.
15. Analytics [2.1]: the six server-side events in 2.1 to Plausible or PostHog; a test import and checkout show all six in the tool, no email address in any.
16. Attribution [2.2]: a credits line for the models from the `Credits` bullet under "Limitations" in `web/README.md`; from the repository root, `grep -rn NVIDIA web/src/app web/src/components` is not empty.

Verification: the ladder; rung 5 for items 8, 11 and 13; `E2E_ADMIN=1` after item 13; items 3 to 7 also checked on the Droplet by the human.

Hand-offs: the backup bucket and confirmation that Droplet backups are on, the worker's size (4 vCPU / 8 GB at least, or a dedicated CPU Droplet), GitHub Actions secrets, Sentry, uptime and analytics accounts, the Clerk webhook secret, a support inbox, the lawyer, and the platform apps Phase 4 needs: apply now.

Report: the operating prompt's format, plus "Droplet steps for the human".

### Phase 2: make people start

Goal: a stranger sees Bamio work before paying, and the first clips are good enough to post.

Items, in order:

1. Free tier or trial with a watermark [2.1]. The human picks one of the three options in 2.1. `allowance()` in `billing.ts` carries `watermark`, false whenever `billingEnabled()` is false (CLAUDE.md: nothing may be limited without the key, so the default e2e suite exports no watermark); `assertCanProcess` lets the free path through and `recordUsage` still counts it; a $0 trial invoice earns no referral credit (`settleReferral` unchanged, with a unit test); an `overlay` step in `renderFilter` with the same mark drawn in `clip-preview.tsx`; `plans.ts` and `/pricing` show the offer. Check: a new `E2E_BILLING=1` test imports without a plan and exports; the watermark rectangle's mean luminance differs by more than 20 from the same rectangle of a paid export (ffmpeg `signalstats`); "Choose a plan to import videos" is gone.
2. Sample project on first sign-in [2.1]. Check: a new account's `/projects` shows one ready project in e2e; signing in twice still gives one; the sample's licence is stated in the code and in the `Credits` bullet of `web/README.md`.
3. Welcome email [2.1]. Clerk `user.created` on the Phase 1 webhook route; a template in `src/lib/email/templates.ts` queued with `queueEmail`, never to `+clerk_test` addresses. Check: `tests/unit/email.test.ts` covers it; e2e finds the previewed email in the `emails` table, as the "clips are ready" test does.
4. Hooks, descriptions and hashtags [4.A.3]. One Gemini call per clip batch, a zod schema in `src/lib/clips/schema.ts`, the UI 4.A.3 describes. Check: the mock is deterministic; a real run on two transcripts is pasted (prompt 4.1); "AI-generated hooks" (Pro) and "AI hooks & titles" (Team) lose `soon`.
5. Loudness normalisation [4.A.8]. Two-pass `loudnorm` to -14 LUFS in `renderArgs`. Check: `ffmpeg -af ebur128` on exports from two sources reads within 1 LU of -14; a unit test covers the filter string.
6. Undo and redo, caption split and merge [4.A.6]. A history stack on the editor's `queue` in `clip-editor.tsx`; `updateSegmentSchema` gains split and merge. Check: e2e edits, undoes, redoes, splits a phrase, merges it back to the same words and times, exports.
7. Batch export [4.A.6]. A job (an `export-batch` kind: the `kind` check migration, a `jobSpecs` entry and a pool) writes a zip of the selected clips into `scratch(projectId)` (a zip library is a new dependency: give the reason), then `publish` under a `mediaKeys` key. Check: e2e downloads the zip and lists two playable MP4s; the job finishes after the worker is killed halfway (the `tests/unit/worker.test.ts` pattern).

Verification: the ladder; rung 2 for every item; `E2E_BILLING=1` for item 1; preview and export together for items 1 and 6; prompt 4.1 for item 4.

Hand-offs: the free-tier decision and its numbers (for a Stripe trial, `npm run stripe:setup` after the price change); a CC-licensed sample video; a week after item 1 ships, you read the funnel numbers in the analytics tool and decide whether the free tier's limits move.

Report: the operating prompt's format and the `soon` lines removed.

### Phase 3: close the feature gap

Goal: the features people compare on before buying work end to end, so most `soon` lines in `plans.ts` come off honestly. Lines no roadmap item reaches ("AI B-roll" twice, "Advanced AI clip selection", "Advanced AI clipping", "Advanced virality scoring"): the human decides per line, build it with the section 3 template or delete the line; neither happens inside a phase item.

Schema rule: `clipEditSchema` and `projectSchema` grow; saved documents must still load. Add fields as optional with defaults, or add `version: 2` with a read-time migration in `store.ts` tested on a saved version-1 document. Never a migration that rewrites every project row in one transaction.

Items, in order; one session per roadmap step:

1. Caption style object, presets and brand kits [4.A.2]; three sessions: schema and renderer, presets, brand kits. Rendered the same by `clip-preview.tsx` and `ass.ts`; 10 to 15 presets; Pro saves custom presets with a logo and watermark position. Check: pick a preset, the preview changes, a sampled export frame matches it; a version-1 project still loads; `E2E_LANGUAGES=1` passes; `soon` comes off "Basic templates", "Advanced templates", "Advanced caption styles", "Custom caption styling", "Unlimited caption styles", "Custom caption templates", "Custom logos", "Brand kits", "1 brand" and "3 brands" as each works, "Custom fonts" only if uploads are real. Every font family in a preset is added to `src/lib/server/caption-fonts.json` (regenerated with fontTools, as CLAUDE.md says; `scripts/setup-media.mjs` downloads from it with a pinned SHA-256), so `assMarkup` and `/api/fonts/captions.css` pick it the same way and fall back to Noto per character for scripts it lacks.
2. Keyframed focus with zoom [4.A.1 step 1]. `focus: { t, x, y }[]` and a zoom factor on the edit, interpolated in the preview, time expressions in the export crop. Check: a unit test on the filter string; a clip with two keyframes exports and frames at both times show the right region.
3. Automatic face tracking [4.A.1 step 2]. A face detector in ONNX (`onnxruntime-node` is a new dependency: give the reason), keyframes written through item 2. Check: on a two-host podcast, at each sampled time the crop centre lies within 10% of the frame width of the detected face of the speaker whose turn it is (the job logs the face boxes it used); CPU time per clip minute in the report; `soon` comes off "AI face tracking", "Smart reframing", "AI video reframing", and Team's "Advanced face tracking" and "Advanced smart reframing".
4. Split and pip layouts for streams [4.A.1 step 3]. Check: a Twitch VOD exports with the face cam on top and gameplay below, in preview and file, after the user drags the cam rectangle once.
5. Silence and filler removal [4.A.4]. Check: cuts show on the trim bar; the export is shorter by the removed time (ffprobe); the caption-sync e2e check still passes; `soon` comes off "Silence & filler-word removal" and "Automatic silence/filler removal".
6. Speaker diarization [4.B.2]. sherpa-onnx segmentation and embeddings in `workers/transcribe.mjs`; `TRANSCRIBER_VERSION` bumped; speakers shown in captions. Check: a two-speaker fixture with known turn times gets two labels in a unit assertion; one-speaker videos get one speaker; "Speaker detection" loses `soon`.
7. 4K export gated to Pro, 720p preview [4.A.7]. `OUTPUT_SIZE` gains both. Check: ffprobe shows 2160x3840 from a 4K source on Pro; Starter gets 1080p and an upgrade note; "4K export" and "4K / high-quality export" lose `soon`.

Verification: the ladder; rung 2 for every item; `E2E_LANGUAGES=1` after items 1 and 6; `E2E_PERF=1` before and after items 3 and 7, timed on the Droplet.

Hand-offs: the OFL font list and which presets ship; a 4K source; a two-host podcast and a streamer VOD with the owner's permission.

Report: the operating prompt's format, the `soon` lines removed, one preview frame beside one export frame per item.

### Phase 4: own the stream niche and publishing

Goal: live streams get Bamio's best clips, and a finished clip reaches the platforms without leaving the app.

Items, in order:

1. Chat recording for followed streams [4.B.1]. Twitch IRC, Kick's chat websocket and YouTube live chat recorded beside the capture, aligned to the capture timeline, stored under a `mediaKeys` key. Check: a follow of `twitch.tv/bobross` records chat whose timestamps line up with the segments; a dropped chat connection reconnects without duplicate messages.
2. Chat marks in the prompt [4.B.1]. `promptLines` gets a `chat` mark beside the loudness marks; `hypeScore` does not change in this session; a chat weight in `hypeScore` is a separate session with prompt 4.1. Check: prompt 4.1 before and after on a real stream transcript shows what the marks change in the first rank.
3. Live moment markers [4.B.1]. Candidate moments on the timeline while following. Check: the `live-stream` e2e sees a marker before the capture ends; clicking one marks a clip.
4. Reconnect after a dropped connection [DESIGN_STATUS.md "Next steps" 5]. `followProject` appends to the same playlist after a network error. Check: a unit test with a playlist that disappears and returns; cutting the network for 30 s during a real follow continues into the same playlist and the final MP4 holds both halves.
5. Publishing with scheduling [4.A.5], one session per platform: YouTube first, then TikTok and Instagram. OAuth tokens encrypted at rest, never in a response; a `publish` job kind (CLAUDE.md: a migration widening the `kind` check, a `jobSpecs` entry and a pool); a "Post" button with hook, description and hashtags prefilled; a schedule table and a calendar. Check: an exported clip posts to a test channel the human owns; a post scheduled ten minutes ahead goes out then; a failed post shows why and retries; "Social media scheduler", "Social media scheduling", "Multiple social accounts" and "Content calendar" lose `soon`.
6. Accuracy loop [4.B.8]. Views per posted clip pulled daily, beside score, length and position in the admin overview. Check: `/admin` shows the table for the test channel, per content type.

Verification: the ladder; `npx playwright test live-stream` with `E2E_LIVE_TWITCH`, `E2E_LIVE_YOUTUBE` and `E2E_LIVE_KICK` set to live channels; rung 6 for items 1 and 4; `E2E_ADMIN=1` for item 6; posting only to test accounts.

Hand-offs: approved platform apps with client ids and secrets (server-side settings, rows in README's table); a test channel per platform; live channels for the tests.

Report: the operating prompt's format, the before-and-after first rank for item 2, the scopes requested per platform, and one table per platform: posted, failed, time to appear.

### Phase 5: scale and business

Goal: Bamio carries a second machine and a few hundred concurrent users, and the Team plan becomes real. Ongoing; one item per session.

1. Entitlements in one place [3.6]. `entitlements(userId)` in `billing.ts` returns what a user may do, fed by the plan, grants and a flags table; `entitlements` calls `allowance` (grants still win) and routes and UI read `entitlements` instead of `allowance`, `aiConfigured` and `billingEnabled`; CLAUDE.md's "anything that reads the plan must go through it" sentence names `entitlements` in the same commit. Check: `E2E_BILLING=1` passes unchanged; `npm run plan:grant` changes what the UI offers without a deploy.
2. Rate limits in Postgres [2.5]. `takeRateLimit` backed by a table (a new migration). Check: two web processes on one database share a bucket in a unit test.
3. Storage quotas and retention [2.3]. Bytes per user from `source`, `exports` and `live`; a retention policy. Check: a user over quota sees the limit on import; an untouched project's source goes after `BAMIO_SOURCE_RETENTION_DAYS` (default 90, a `web/README.md` row), after a "your video will be archived" email queued with `queueEmail` seven days before (opt-out in `notifications.ts`); its clips, transcript and exports stay, and re-importing the same link restores it.
4. SSE for project changes [3.3]. A route per project forwarding Postgres `NOTIFY`, polling as the fallback, progress in a `job_progress` table. Check: the network tab shows one event stream and no 1 s polling while an import runs; closing the stream falls back to polling.
5. Direct-to-storage uploads [3.4]. Presigned part URLs, the multipart finished server-side. Check: a 100 MB e2e upload with `STORAGE_DRIVER=s3` against s3rver; the current route still works for local storage.
6. R2 for media; Postgres on its own volume with WAL archiving, or managed [3.1]. A copy script and the rollback in `DEPLOY.md`. Check: e2e passes with `STORAGE_DRIVER=s3` against R2; a point-in-time restore rehearsed.
7. Release process [3.7]: tagged images, `CHANGELOG.md`, migrations as a deploy step that stops the deploy on failure. Check: one release followed `DEPLOY.md`.
8. Admin operator metrics [3.8]. Check: imports per day, median time per step by language and failures by error code on `/admin`.
9. Autoscaled or GPU workers [3.2]. Check: `checks.queue.oldestWaitingSec` on `/api/health` stays under 600 through 10 parallel imports.
10. Teams and client approval [4.C.1], after clips move to their own table [3.5]. Check: two users edit different clips of one project at once without losing a change; a client approves a clip by link; "2 users", "5 team members", "Team collaboration", "Client approval workflow" and "10 brands/client workspaces" lose `soon`.
11. Public API and webhooks [4.C.2]. Check: `POST /v1/imports` with an API key starts an import and a webhook fires on ready; "API access" loses `soon`.
12. Analytics for posted clips [4.C.3], localised UI [4.C.5], browser extension [4.C.4]: one each. Check: analytics shows views, likes and shares per posted clip per platform on the project page within a day of posting, and "Advanced analytics" loses `soon`; the UI switches to Spanish from `/profile` and every string on `/projects`, `/new` and the editor is translated (a unit test finds no untranslated key); the extension adds "Clip with Bamio" on a YouTube watch page and opens `/new` with the link filled.

Verification: the ladder; `E2E_PERF=1 npx playwright test perf` before and after every speed item; rung 5 for items 5 and 6; `E2E_BILLING=1` for items 1 and 3.

Hand-offs: money decisions (Droplet sizes, managed Postgres, GPU), the R2 account, Clerk organisations, API pricing.

Report: the operating prompt's format, plus before and after numbers for every speed, load or cost claim.

### Backlog: items no phase prompt covers

Run each with the section 3 template. Punctuation and capitals for Omnilingual languages [4.B.3]; translated captions [4.B.4]; "clip anything" by prompt [4.B.5]; chapters and summaries [4.B.6]; per-platform safe zones [4.B.7]; the rest of the editor basics [4.A.6]; music bed [4.A.8]; scene-change marks and mixed clip lengths [section 5]; YouTube cookie rotation, the PO-token plugin or a residential proxy, and a one-click "download it yourself with this command" help when a link fails [2.5]; Dependabot or Renovate [2.5]; `BAMIO_*_SLOTS` tuned to cores and a pool for small jobs (frames, lookups) [3.1]; publishing to X [4.A.5]; a log line when a worker heartbeat has failed for over a minute [section 5, `worker.ts`]; a staging host [2.3]; Drive, Dropbox, Zoom and RSS imports [4.C.4]; PWA install and share target [4.C.6]; marketplace and growth loops [4.C.7].

## 3. Single-item prompt template

Fill every slot; a vague slot is how scope widens.

```
Item: <one sentence: what exists when this is done>
Roadmap: ROADMAP.md section <n>, <bullet or table row>; DESIGN_STATUS.md <entry, if any>
Outcome: <what a user sees afterwards, one sentence>
Metric: <the ROADMAP.md section 7 line it moves>
Files: <every file you expect to change, with the function or export in each>
Tests: <unit test files to add or change; e2e spec and step>
Acceptance (a reviewer checks these in the running app, without reading code):
  1. <open this, do this, see this>
  2. ...
Verification: <the ladder rungs that apply, by command, plus any flag or real-data check>
Rollback: <what undoes this in production: a setting, the migration's reverse, the previous image tag>
Out of scope: <neighbouring items the agent must not touch, by name>
Human provides: <keys, decisions, test material, or "nothing">
Start with the plan.
```

Filled example:

```
Item: Scratch folders left behind by failed, cancelled or crashed jobs are deleted by the worker.
Roadmap: ROADMAP.md 2.4 first bullet; section 5 table, row "runImport".
Outcome: a failed import no longer leaves gigabytes under BAMIO_WORK_DIR.
Metric: cost (storage bytes per user); reliability (assertDiskSpace stops refusing work).
Files: web/src/lib/server/worker.ts (a sweep beside pruneJobs on its timer), web/src/lib/server/store.ts (workRoot, scratch), web/README.md (a BAMIO_SCRATCH_TTL_HOURS row, default 6).
Tests: web/tests/unit/worker.test.ts: old and idle removed; running job kept; young kept; a non-project name left alone.
Acceptance:
  1. Start an import, cancel it during download: within one sweep interval its folder under BAMIO_WORK_DIR is gone.
  2. Start an import and let it run: its folder stays until the import ends.
Verification: npm run check; npm run build; npm run test:e2e.
Rollback: BAMIO_SCRATCH_TTL_HOURS=0 turns the sweep off; no migration.
Out of scope: orphaned media, abandoned uploads, the frames cap (ROADMAP 2.4 bullets 2 to 4).
Human provides: nothing.
Start with the plan.
```

## 4. Special-purpose prompts

Each is pasted after the operating prompt.

### 4.1 Tuning the Gemini clip prompt

You are changing how Bamio picks clips: `HIGHLIGHT_SYSTEM`, `highlightPrompt`, `promptLines`, `clipTarget` or `hypeScore` in `web/src/lib/ai/server/clips-ai.ts`.

1. `GEMINI_API_KEY` set, `BAMIO_AI_MOCK` unset; `npm run ai:check` passes.
2. At least three real transcripts the human names (a podcast, a stream, a talk, each over 40 minutes with `transcript.loudness`). Measure with a throwaway `tests/unit/tune.test.ts` that loads `web/.env` with `@next/env` (as `scripts/check-ai.mjs` does), then sets `process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:54329/bamio"` before its first call into `store.ts` (Vitest points `DATABASE_URL` at `bamio_test` and `tests/unit/db-setup.ts` wipes that database before every run, so `readTranscript` finds nothing there; `db()` reconnects when the URL changes), reads each transcript with `readTranscript` in `store.ts` and calls `findHighlights`, taking tokens from the `[bamio/ai]` log line in `gemini.ts`; run it with `npx vitest run tests/unit/tune.test.ts`, delete it before the ladder, never commit it. Run `tests/e2e/live-ai.spec.ts` too, against a server started without `BAMIO_AI_MOCK` and with the key: `npm run build`, then `DATABASE_URL=postgres://postgres@127.0.0.1:54329/bamio BAMIO_BILLING=off BAMIO_EMAIL=preview npx next start -p 3200`, then `E2E_LIVE_AI=1 E2E_PORT=3200 npx playwright test live-ai` (without `E2E_PORT` it runs against the mock server on 3100); it needs `qa/fixtures/speech-talk.mp4` (gitignored, made by hand: ask the human for it, or record 58 s of speech over a test pattern with ffmpeg first).
3. Baseline on the current code, then your change, same transcripts, same `clipLength`, same `avoid`. One variable at a time. Run the changed version twice more to see the variance.
4. Record per run: clips asked (`clipTarget`) and returned; score min, median, max and the count of distinct scores; how many of the top 10 lie on `!` or `!!` lines; the first-ranked clip's time and title, and whether you agree after watching it; tokens in and out.
5. Keep the change only if the count holds, the spread does not shrink and the first-ranked clip is at least as good. Never change `MAX_CLIPS_PER_SEARCH` or the zod schema to improve the numbers; the mock AI tests must still pass. Put the table in the report and in the `DESIGN_STATUS.md` entry, as "More clips, ranked by hype (2026-10-04)" does.
6. Update the prompt tests in `tests/unit/server.test.ts`, then the ladder. Hand back the top three clips per transcript for the human to watch.

### 4.2 Security review of a change

Review the diff named below against `CLAUDE.md` "App" and `ROADMAP.md` 2.5. Change nothing; report, with file and line:

- Every new route goes through `userRoute` (or `adminRoute`), reads its body with `readJson` and a zod schema, and has `takeRateLimit` or a `limiter` where a stranger could loop it. Webhooks verify a signature over the raw body before parsing (`verifyWebhook` in `billing.ts` is the pattern).
- No file path or storage key is built from input without `isProjectId`, `isUserId` or `mediaKeys`; media goes through `storage()`.
- Any URL reaching yt-dlp, ffmpeg or `fetch` passed `checkPublicUrl`; say what happens on a redirect to a private address.
- Secrets read only in `src/lib/server` and `src/lib/ai/server`: from the repository root (not `web/`), `grep -rn "process\.env\.\(GEMINI_API_KEY\|STRIPE_SECRET_KEY\|STRIPE_WEBHOOK_SECRET\|RESEND_API_KEY\|S3_SECRET_ACCESS_KEY\|CLERK_SECRET_KEY\)" web/src | grep -v "lib/server\|lib/ai/server"` prints nothing and exits 1 (same for the NVIDIA grep in Phase 1 item 16); no new `NEXT_PUBLIC_`.
- Admin pages call `requireAdmin()`, outsiders get 404, changes are logged with `logAdminAction`.
- Row locks are not held across network I/O; jobs stay idempotent and honour `signal`; nothing starts work except `enqueue`.
- Migrations are additive with the reverse in a comment; headers in `next.config.ts`, `src/proxy.ts` and `Caddyfile` unchanged or stricter; new dependencies listed with why and `npm audit --omit=dev` output.

Report a table: finding, severity (blocks merge, fix soon, note), file:line, the failure scenario, the fix in one sentence. End with the greps you ran and their output.

### 4.3 UX and responsive review with Playwright

Start the test server as `web/README.md` describes, then run `E2E_RESPONSIVE=1 npx playwright test responsive` and `E2E_SCREENSHOTS=1 npx playwright test screens`. Read every `qa/responsive/report-*.json` and the screenshots. Then drive each changed screen with `playwright-cli` at 320, 390 and 1440 wide, light and dark, once with the keyboard only, in the states the suite does not reach: a title of 120 characters, a project with 40 clips, a failed import, an empty `/projects`.

Report each finding as: screen, width, theme, screenshot path in `qa/`, what is wrong (sideways scroll, past the edge, tap target under 24px, focus not visible, copy off Bamio's voice, hard-coded value where a token exists in `tokens.css`), the fix in one sentence. Fix nothing unless the item prompt says to; then re-run the responsive suite and paste the summary.

### 4.4 Drafting the legal pages

Draft `/terms`, `/privacy` and `/takedown` for a lawyer to review. You are not giving legal advice: put every company fact in square brackets, mark every judgement call `[LAWYER: ...]`, and list both in the report.

State these facts plainly, each taken from the code with its file named: sign-in by Clerk; payments by Stripe, with a refund line; emails by Resend; transcription on Bamio's own server (audio never leaves it while `BAMIO_LOCAL_TRANSCRIBE` keeps its default; `src/lib/server/transcribe.ts` sends audio to Gemini when it is `0`, so state the production value); transcript text sent to Google Gemini for clip finding; media on Bamio's server or an S3-compatible store, kept until the project or account is deleted; the referral cookie from `/r/[code]` lasting 60 days; account deletion and data export (Phase 1 item 13); the acceptable-use line matching the existing "Only import videos you own or have permission to use" notice; a takedown address and procedure.

Build them as public pages: in the sitemap, in a legal group in the footer in `site-chrome.tsx`, with `pageMetadata` and an `opengraph-image.tsx` each; `tests/unit/seo.test.ts` must pass. The branch stays unmerged until the human says the lawyer has signed off; put under "Needs from you" the decision whether to publish earlier with a visible "Draft, under legal review" notice.

### 4.5 Release to the Droplet with rollback

Release commit <sha> to bamio.app. The human runs every SSH step and pastes the output back.

Before: CI green on <sha> (until Phase 1 item 2 exists: the ladder run locally on <sha>, output pasted); the unapplied files in `web/db/migrations/` read, each additive with its reverse noted; `docker compose exec -T postgres pg_dump -U bamio bamio | gzip > ~/backups/pre-<sha>.sql.gz`, restored into a scratch database and `select count(*) from projects` compared: stop here until the count matches; `/api/health` says `status` `ok` and `/admin/jobs` shows no running follow job, or the human accepts that `stop_grace_period: 30s` ends followed streams with the "restart" end reason; note the current commit or image tag.

Deploy: the commands in `web/DEPLOY.md` "Updating" (today `git pull && docker compose up -d --build`; once Phase 1 item 3 lands, `docker compose pull && docker compose up -d`, with `--no-deps app` once services are split). Then `docker compose ps`, `curl -fsS https://bamio.app/api/health`, import a short public link and export a clip; `docker compose exec app node scripts/indexnow.mjs` if public pages changed.

Rollback, written before the deploy: check out the previous commit and `docker compose up -d --build`, or `BAMIO_IMAGE_TAG=<previous sha> docker compose up -d`. If the schema must come back: the reverse statement through `docker compose exec -T postgres psql -U bamio bamio`; the pre-release dump only if data is wrong. Record the release in `DESIGN_STATUS.md`, and in `CHANGELOG.md` once Phase 5 item 7 creates it (there is none today).

## 5. Reviewing a session's output

You, or a second agent given the operating prompt, the item prompt and this section. Any failed line is a reject; do not fix the work in the review.

1. The report has all six headings. Every command under "Commands run" has pasted output, not a sentence. "Not verified" matches the rungs the change required; "Needs from you" names anything the agent could not run.
2. `git diff main...<branch> --stat` matches the plan and "Changed"; every extra file is explained.
3. Every acceptance criterion in the item prompt is something you can do in the app. Do each yourself.
4. Tests were not weakened: `git diff main...<branch> -- web/tests | grep -E "^-.*expect\(|^\+.*\.(skip|only)\(" | grep -v "process\.env\.E2E_"` is empty, or every line it prints is a test the "Changed" section names with the reason it changed; the Vitest total is not lower than on `main`; new behaviour has a test that fails without the change; `web/playwright.config.ts` still sets `BAMIO_AI_MOCK`, `BAMIO_EMAIL=preview` and the billing guard.
5. Re-run yourself, from `web/`: `npm run check`, `npm run build`, `npm run test:e2e`; then `E2E_RESPONSIVE=1` if UI changed; `E2E_BILLING=1` if `billing.ts` or `plans.ts` changed; `E2E_ADMIN=1` if admin changed; both storage drivers if `storage.ts`, `store.ts` or `live-media.ts` changed; prompt 4.1 for `clips-ai.ts`; prompt 4.2 for a route or webhook.
6. Docs: `DESIGN_STATUS.md` has a dated entry and its "Last updated" line moved; `web/README.md` has a row for every new script, setting or flag; `web/DEPLOY.md` for anything an operator does, with a rollback line for any `compose.yaml`, `Dockerfile` or `Caddyfile` change.
7. Schema: `git diff main...<branch> -- web/db/migrations/` touches no applied file; a new migration is additive with the reverse in a comment.
8. `plans.ts`: a `soon` line removed only for a feature you have just seen work in the app and an e2e test exercises.
9. Greps on the diff: the secret grep from prompt 4.2 is empty; no `NEXT_PUBLIC_` added; no hard-coded colours or sizes where a token exists; no em dash (PowerShell: `[Console]::OutputEncoding = [Text.Encoding]::UTF8; git diff main...<branch> | Select-String -Pattern ([char]0x2014)`; bash: `git diff main...<branch> | grep -n $'\xe2\x80\x94'`, which works in any locale, where `grep -P "\x{2014}"` errors outside UTF-8).
10. A new dependency has its one-line reason and `npm audit --omit=dev` is clean.

Reject outright when: a command is described as passing without output; verification was skipped without saying so; the diff reaches outside the item; a test was deleted, skipped or loosened; a `soon` flag came off a feature that does not work; the voice slipped (em dashes, "seamless", "robust", "leverage", "delve"). Send it back in a new session with the same item prompt plus one line: "Previous attempt failed at: <step>."

Merge when everything holds. Then deploy with prompt 4.5, never from a laptop checkout.

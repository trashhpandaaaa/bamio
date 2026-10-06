# Bamio web app

Bamio turns long videos into vertical shorts. Paste a YouTube, Twitch or Kick link (or any site yt-dlp supports), or upload a file. Bamio transcribes it, finds the moments that work as standalone clips, and lets you trim, reframe (9:16, 1:1, 16:9), caption word by word and export 1080p MP4s.

Built with Next.js 16 (App Router), React 19, TypeScript, Postgres (data and the job queue), local or S3-compatible storage (videos), Clerk (sign-in), on-device speech recognition in any language with word timing (via sherpa-onnx: NVIDIA Parakeet, Meta Omnilingual ASR, Whisper for detecting the language, Silero VAD), Google Gemini (clip finding), yt-dlp (link import) and ffmpeg (processing and export). The visual design comes from `../design/` (direction: Hook).

## Quick start

```sh
cd web
npm install
npm run setup:media     # yt-dlp into web/.bin, speech models and caption fonts into web/.models (~1.9 GB), all checksum verified
npm run db:local        # a Postgres for development in web/.pg (needs Postgres 16+ installed), on 127.0.0.1:54329
npm run ai:check        # confirms the Gemini key and models work
npm run dev             # http://localhost:3000 (it also runs the background jobs)
```

Upgrading from the version that kept projects as JSON files: `node scripts/db-import-disk.mjs` copies them (and billing and usage) into the database; the media files stay where they are.

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
| `DATABASE_URL` | the local one in development | Postgres 16+: projects, transcripts, jobs, billing, usage. Required in production. `DATABASE_POOL_SIZE` (10) per process. |
| `STORAGE_DRIVER` | `local` (`s3` with `S3_BUCKET`) | Where videos, thumbnails, frames and exports are kept: files under `BAMIO_DATA_DIR`, or an S3-compatible store (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=1` for MinIO, `S3_PUBLIC_ENDPOINT` when browsers reach it elsewhere). |
| `BAMIO_DATA_DIR` | `web/.data` | Local storage's folder. |
| `BAMIO_WORK_DIR` | `web/.work` | Scratch space for work in progress (downloads, prepared videos, renders). |
| `BAMIO_WORKER` | on | The web server also runs background jobs. `off`: it only queues them, for worker processes (`npm run worker`). `BAMIO_IMPORT_SLOTS` (2), `BAMIO_EXPORT_SLOTS` (2), `BAMIO_STREAM_SLOTS` (4): jobs at once per process. |
| `BAMIO_MODELS_DIR` | `web/.models` | Where the speech models and caption fonts are kept. |
| `BAMIO_LOCAL_TRANSCRIBE` | on | `0` transcribes with Gemini instead (not recommended: timing is far less accurate). |
| `BAMIO_FOLLOW_MAX_BACK_SEC` | 21600 (6 h) | How far back following a live stream may start. |
| `BAMIO_SPEECH_MODEL` | `accurate` | `fast` uses smaller models: English Parakeet 110M, other languages Omnilingual 300M. About twice as fast, a few percent less accurate. |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH` | bundled | Use your own builds of the media tools. |
| `STRIPE_SECRET_KEY` | none | Turns plans and payments on (see below). Without it nothing is limited. Stays on the server. |
| `STRIPE_WEBHOOK_SECRET` | none | Signing secret of the Stripe webhook (`whsec_...`). |
| `BAMIO_APP_URL` | the request's address (`http://localhost:3000` for emails in development) | The site's address, e.g. `https://bamio.example.com`: where Stripe sends people back to, and the links in emails. Required for emails in production. |
| `BAMIO_BILLING` | on with a key | `off` turns plans off even with a Stripe key: for local work, and the end-to-end test server (Playwright sets it). |
| `RESEND_API_KEY`, `EMAIL_FROM` | not set (no emails) | Emails to users through [Resend](https://resend.com): the API key, and the sender on a domain verified in Resend, e.g. `Bamio <hello@your-domain.com>`. `EMAIL_REPLY_TO` optionally. See Emails. |
| `YTDLP_COOKIES` | not set | A cookies.txt from a spare YouTube account, passed to every yt-dlp call. Servers in data centres get YouTube's "confirm you're not a bot" without it. See DEPLOY.md. |
| `BAMIO_EMAIL` | on with a key | `off`: no emails. `preview`: emails are written and logged, never sent (no key needed; the end-to-end test server, which Playwright sets). |

## Plans and payments (Stripe)

Plans are **Starter** ($12 a month or $30 every 3 months, 150 AI minutes a month), **Pro** ($24 / $60, 400 minutes, most popular) and **Team** ($54 / $144, 1,000 minutes). The catalog, with every feature line, is `src/lib/billing/plans.ts`; features Bamio doesn't have yet carry `soon: true` and show under "Coming soon" on `/pricing` (remove the flag when one ships).

Without `STRIPE_SECRET_KEY`, `/pricing` shows the plans but can't sell them, and importing isn't limited (as before). With it:

- **Importing needs a working plan** (paid, or Stripe still retrying a failed payment), apart from a new account's free first video (below). Each import uses its length in AI minutes (a part uses only the part; a followed stream uses what gets captioned, and following stops when the minutes run out). Minutes renew every month on the day the plan started, also on 3-month plans; unused ones don't roll over. Finding more clips, editing and exporting use none, but AI on an existing video still needs a plan. Plans also keep 50 / 150 / 400 projects, and Pro and Team go first in every processing queue.
- **Buying** is Stripe Checkout (`/pricing`); **changing plan, card, invoices and cancelling** are Stripe's billing portal (Plan & billing in the account menu, `/billing`). Upgrades start at once and charge the difference; smaller plans and switching from 3 months to monthly start at the end of the period paid for; cancelling keeps the plan to the end of the period.
- **Setup:** add `STRIPE_SECRET_KEY` (test key first), run `npm run stripe:setup` (creates the products, the six prices under lookup keys like `bamio_pro_quarter`, and the portal settings; safe to re-run, and a changed price in `plans.ts` replaces the old one), then send Stripe's events to `/api/billing/webhook`: locally `stripe listen --forward-to localhost:3000/api/billing/webhook` and put the `whsec_...` it prints in `STRIPE_WEBHOOK_SECRET`; in production `npm run stripe:setup -- --webhook https://your.domain`. Restart the server.
- **Promotion codes:** Checkout accepts Stripe promotion codes (made in the Stripe Dashboard → Product catalog → Coupons). A checkout whose total is $0 doesn't ask for a card (`payment_method_collection: if_required`). Live: `BAMIOFREE`, 100% off forever, 5 uses (lowered from 50 on 2026-10-02 by replacing the code: Stripe can't change a code's limit, so a new limit means switching the code off and creating it again on the same coupon).
- **Referrals:** every user has a link, `https://bamio.app/r/<code>` (Plan & billing → Refer a friend, also in the account menu). A visitor who arrives through it keeps the code in a cookie for 60 days; it's recorded when they first go to checkout: only for someone who has never had a plan, never their own link, one referrer per person. When their first payment with money in it goes through (Stripe's `invoice.paid` webhook, or the next time Bamio reads their subscription), the referrer earns $5 (`REFERRAL_REWARD_CENTS` in `plans.ts`), once per friend: put on the referrer's Stripe customer balance, so it comes off their next invoice, or saved until their first checkout if they've never had a plan. They get an email either way. A $0 checkout (a 100%-off code) earns nothing. The friend gets nothing extra. Records: `src/lib/server/referrals.ts`; Stripe: `settleReferral` and `creditReferrer` in `billing.ts`. The webhook endpoint needs the `invoice.paid` event (`npm run stripe:setup -- --webhook https://your.domain` adds it).
- **Free first video:** an account that has never had a plan (paid or given) can import its first video free, up to 30 minutes of it (`FREE_TRIAL` in `plans.ts`, counted over the account's life, not monthly), with every feature, one project at a time. `trial` in billing.ts feeds the same gates as a plan (`assertCanProcess`, `assertPlan`, `secondsLeft`, `projectLimit`); the import page, Plan & billing and Pricing say so. When it's used (`trial_used`), or once a plan has ended, importing needs a plan.
- **Free plans:** `npm run plan:grant -- someone@example.com pro` gives a user a plan without paying, for good (the owner, testers, partners); `none` takes it back, `-- --list` shows who has one. The user is found in Clerk by email, so they must have signed up. Where someone also pays, the better plan counts. `/billing` shows it as Free, with no price or renewal.
- **State** is kept in the database: `billing_accounts` (Stripe customer and subscription, per user) and `usage_entries` (one row per import or stream piece, keyed, so a retried import counts once). Webhooks keep it current; the server also reads it from Stripe when it may be stale (a renewal due, half an hour old) and when `/billing` opens, so plans keep working where webhooks can't reach the server.

## Emails (Resend)

Bamio emails users when something happens that they'd want to know, through Resend:

| Email | When | Can be turned off |
|---|---|---|
| Welcome to your plan | A plan starts (a checkout is paid) | No |
| Plan changed | A switch to another plan or billing period takes effect | No |
| Plan ends on (date) / Plan continues | Cancelling, or undoing a cancellation, in the billing portal | No |
| Payment didn't go through | A renewal payment fails (Stripe keeps retrying for a few days) | No |
| Plan has ended | The plan is cancelled for good, or unpaid once Stripe stops retrying | No |
| Most of your AI minutes are used / used up | At 80% of the month's minutes, and when they run out (once each per month and plan) | Yes |
| Your clips are ready / Couldn't import | An import or a followed stream finishes (with its 3 best AI clips and a link), or an import fails | Yes |

- **Settings:** Profile → Notifications (`/profile/notifications`, stored on the Clerk user like the clip defaults) turns off the video and minutes emails. Plan and payment emails always go out. Emails go to the user's primary address in Clerk, read when the email is sent.
- **How:** code that has news queues an email with a key naming it (`queueEmail` in `src/lib/server/email.ts`, the only reader of `RESEND_API_KEY`) into the `emails` table; plan emails are queued in the same transaction that saves the plan. A key is used once per user, so a webhook delivered twice or an import retried sends nothing new. The workers' mailer sends what's queued: it looks the user up in Clerk, writes the email (`src/lib/email/templates.ts`: HTML in Bamio's colours with a plain-text copy, light and dark), and sends it with an idempotency key, so a worker that dies mid-send can't send it twice. When Resend or Clerk can't be reached it tries again (1 min, 5 min, 20 min, 1 h, 3 h); a refusal (a bad address, an unverified sender) fails the email. The table records what went out, to whom and Resend's id; old rows are removed after 180 days.
- **Setup:** add your domain at [resend.com/domains](https://resend.com/domains) and its DNS records, make an API key (sending access), and set `RESEND_API_KEY`, `EMAIL_FROM` (on that domain) and `BAMIO_APP_URL` in `web/.env`. Check it with `npm run email:check -- you@example.com`, then restart the server (and the workers). Until a domain is verified, Resend only sends to your own account's address.
- **Stripe's own emails:** Stripe can also email receipts and failed-payment notices (switched on and off in the Stripe Dashboard's customer email and subscription settings). Keep its receipts if you want them (Bamio doesn't send receipts), and turn its failed-payment emails off so customers don't get two.

## Admin panel

`/admin`, for the people who run Bamio. Anyone else, signed out or not, gets a 404 there (and `/admin` isn't in `robots.txt`, so nothing points to it); admins find it in the account menu.

- **Who:** superadmins are named on the server, `BAMIO_SUPERADMINS` in `web/.env` (email addresses, matched to the account's verified primary email in Clerk; restart after changing it). They add and remove admins under Admin → Admins, by the email of an existing account (the `admins` table). Roles are remembered for a minute per server process.
- **What admins see:** Overview (users, paying subscriptions and their monthly value at list prices, free plans, projects, AI minutes, the queue, emails, free disk), Users (search by email or name; each user's plan, referrals, projects with their errors, jobs and emails), Jobs and errors (running and waiting, failed in the last 7 days, all recent, emails sent) and Money (subscriptions by plan, money paid from Stripe's invoices over 30 days and this month, promo codes and their uses, free plans, referrals). Times are UTC.
- **What admins can do:** retry a failed or cancelled job the way its owner would (only the newest of its kind for that project, so nothing runs twice), and cancel a queued or running one: its owner sees it failed, with Try again (`cancelJob` in `jobs.ts`; a followed stream is stopped instead and keeps what was recorded). Superadmins can also give or take back a free plan (the same `plan_grants` as `npm run plan:grant`) and manage admins.
- **Log:** every change made from the panel is in `admin_actions` (who, what, to whom), shown under Admin → Admins.
- **Code:** `src/lib/server/admin.ts` (roles, `requireAdmin` for pages, `adminRoute` for `/api/admin/*`, the queries), `src/app/admin/` (server-rendered pages; `admin-controls.tsx` holds the buttons), `adminRevenue` / `adminPromoCodes` in `billing.ts`.

## Accounts and legal pages

- **Deleting an account:** Profile → Delete account (`/profile/delete-account`). It asks for a tick and a confirmation, then `DELETE /api/account` records the request (`account_deletions`) and deletes the Clerk user at once, which ends the session. The workers' sweeper (`src/lib/server/accounts.ts`, started with the job worker) does the rest, again after a crash or an error, every step safe to repeat: the Stripe subscriptions end at once (no refund) and the customer is deleted (`closeBilling` in billing.ts, never with plans off), the user's jobs stop, their media and scratch folders go, then every row about them (projects with transcripts and jobs, billing, usage, free plans, referrals, emails, admin role). The `account_deletions` row stays, with only the user id. A deletion that keeps failing (3 tries) is an alert. Clerk's own Delete account (Security) is hidden (`profileSection__danger` in `clerk-appearance.ts`), since it would delete only the Clerk user.
- **Deleted in Clerk's dashboard:** Clerk's webhook (`/api/clerk/webhook`, Svix signature checked with `CLERK_WEBHOOK_SIGNING_SECRET`) turns `user.deleted` into the same request. Set it up in the Clerk dashboard → Webhooks → Add endpoint, `https://your.domain/api/clerk/webhook`, event `user.deleted`, and put its signing secret in `.env`.
- **Legal pages:** `/terms`, `/privacy` and `/takedown` (`src/app/<page>/page.tsx`, laid out by `components/site/legal-page.tsx`). The company's name, country, address and contact email are in `src/lib/legal.ts` (`COMPANY`). While `ready` is false they're placeholders: the pages render (to read the drafts) with a draft notice and `noindex`, and aren't in the footer, the sitemap or the FAQ. Fill in the details, set `ready: true`, and have a lawyer read them; the footer links, sitemap entries and the FAQ's takedown link then appear. Keep them true to the code: what's collected, who processes it (the privacy page lists the providers), how long things stay (emails 180 days, backups 14 days).

## Clippers page

`/clippers`: a public wall of people who clip with Bamio, for visitors to see and for creators to find a clipper. Nobody is on it without asking, and nothing shows that an admin hasn't seen.

- **Opting in:** Profile → Clippers page (`/profile/clippers`): a switch, a name for the card, one line about themselves (140 characters) and a link to their channel. The link must be a channel on YouTube, Twitch, Kick, TikTok, Instagram or X (`clipperLink` in `src/lib/profile/clipper.ts`: https, a known host, a path, no spaces or brackets), so a card can't link just anywhere. Saving stores the entry with their Clerk picture (`clipper_profiles`, migration 0008) as "pending"; turning the switch off deletes it at once.
- **Approval:** Admin → Clippers lists everyone who asked, those waiting first. Approve makes the card public and emails its owner (`clipper-approved`, once per approval); Hide takes it down, and its owner is told in their profile. Whatever a user changes afterwards (name, line or link) goes back to "pending" and off the page until it's looked at again; saving the same words keeps the approval. Superadmins get an email once a day while anyone is waiting (`alerts.ts`), and the admin overview shows the count. Admins (not only superadmins) can approve and hide; each action is logged.
- **The card** shows the picture (or their initial), the name, the line, the channel (opening in a new tab, `rel="nofollow ugc"`) and how many clips they've exported in the projects they still keep; cards with the most clips come first. User ids are never on the page.
- **The page** reads the database at request time (`await connection()`, not built ahead like the marketing pages) and keeps the list in memory for a minute (`listClippers` in `src/lib/server/clippers.ts`). It's in the header and footer links, the sitemap, and has its own share image.
- **Deleting an account** removes the card (`deleteAccountData`). The privacy page says what the card makes public.

## Monitoring

- **Errors:** Sentry, with `SENTRY_DSN` (server and workers) and `NEXT_PUBLIC_SENTRY_DSN` (browsers, built into the pages; a Docker build argument). Without them nothing is sent and the browser loads nothing. `src/lib/server/monitor.ts`: `reportError` sends handled errors with what the server was doing (request id, user id, job), from `errorResponse` (a route's unexpected 500), the worker (a job that fails for good for a reason that isn't the user's), and account deletions; `onRequestError` in `instrumentation.ts` sends what Next.js catches itself. No cookies, headers, bodies or query strings are sent, and no performance tracing.
- **Logs:** in production every `console` line is one JSON object (`time`, `level`, `msg`, `err`, `data`), with the request (`reqId`, Cloudflare's ray id when there is one, also in the `x-request-id` header of every API answer) or the job (`jobId`, `kind`, `projectId`, `userId`) it belongs to (`src/lib/server/context.ts`). `BAMIO_LOG_FORMAT=text` for plain lines. On the Droplet: `docker compose logs app | grep '"level":"error"'`.
- **Alerts:** every 5 minutes a worker checks for 3 or more jobs failed in the last hour, a job waiting over 15 minutes, and account deletions that keep failing (`src/lib/server/alerts.ts`); each problem emails the superadmins (`BAMIO_SUPERADMINS`, template `ops-alert`, once an hour) and goes to Sentry. Thresholds: `BAMIO_ALERT_FAILED_JOBS`, `BAMIO_ALERT_WAIT_MIN`, `BAMIO_ALERT_EVERY_MIN`.
- **Uptime:** `.github/workflows/uptime.yml` checks `https://bamio.app/api/health` every 10 minutes (three tries, a minute apart); GitHub emails a failed run. `HEALTH_URL` (a repository variable) changes the address.

## Continuous integration

`.github/workflows/ci.yml`, on every push to main and every pull request: `npm run check` with a Postgres service, `npm run build`, the worker bundle, the Docker image, and the end-to-end suite on Chromium (mock AI, plans off, emails previewed, the admin tests on). The e2e job needs the Clerk development instance's keys as repository secrets, `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY`; without them it's skipped. Its speech models are cached between runs; failures upload `test-results/` and `qa/`.

## Search engines

- **Public pages:** `/`, `/pricing` and four pages for what people search for: `/youtube-to-shorts`, `/podcast-clips`, `/twitch-clips`, `/auto-captions` (`components/site/use-case.tsx` lays them out; each page passes its words). They're listed in `USE_CASES` (`src/lib/site.ts`), which feeds the footer and the sitemap; a unit test fails if a public page is missing from it or has no share image.
- **Every public page** sets its title, a description of at most about 160 characters, its canonical address and its link preview with `pageMetadata`, and has an `opengraph-image.tsx` (1200 x 630, drawn by `src/lib/og.tsx` in Bricolage with the design tokens). Pages behind sign-in (and sign-in itself) are `noindex` (`PRIVATE_PAGE`).
- **Structured data** (JSON-LD, `components/site/json-ld.tsx`): Organization, WebSite, SoftwareApplication with every plan's price from `plans.ts`, the FAQ (answers as plain text: `text` on a FaqItem whose answer has links), and breadcrumbs. No ratings or reviews: there are none to show.
- **Files:** `/robots.txt` (`app/robots.ts`: the API and signed-in pages left out), `/sitemap.xml` (`app/sitemap.ts`), `/manifest.webmanifest`, `/favicon.ico` (48), `/icon.svg`, `/icon1.png` (192, for search results: Google wants a favicon a multiple of 48 px), `/apple-icon.png` and `/icon-192.png` / `/icon-512.png` (`node scripts/make-icons.mjs` makes the PNGs and ICO from `icon.svg`), and the IndexNow key (`public/<key>.txt`, used by `npm run seo:indexnow`).
- **Speed** (Google ranks on it): the hero's first frame loads with high priority and decodes at once, other stills load lazily, the demo loops start only after the page has loaded, the monospace font isn't preloaded, and `/landing/` files are cached for a week.

## How it works

1. **Import** (`/new`): paste a link (Bamio shows the title, channel and length as you paste) or drop a file. Choose part of a long video, the spoken language (detected automatically unless you pick one), whether to find clips with AI, clip length, format and caption style. For a live stream, **follow the stream** (the default): Bamio captures it from as far back as it keeps (Twitch: the start of the stream; YouTube: its rewind history; Kick: from now) and keeps adding to it until the stream ends, you stop, or 12 hours are captured. The project opens as soon as the first seconds are in, and you can clip, edit and export while it grows; captions and AI clips follow along, and when it ends it becomes a normal video. Or **capture a part**: how far back to start and how long to keep recording.
2. **Processing** runs as background jobs and continues if you leave the page (or a worker restarts): download or upload, prepare a browser-playable MP4, transcribe on this device (any language, with a time for every word), then find clips with Gemini. Progress shows as steps.
3. **Project** (`/projects/[id]`): watch the source, see AI clips with a score and the reason they were picked, or mark your own with I and O. Export or download each clip.
4. **Clip editor** (`/projects/[id]/clips/[clipId]`): trim on a filmstrip, pick the format, drag the picture to reframe (or fit it over a blurred fill), choose caption style and position, fix caption words, add a title. Changes save automatically. Export renders on the server and the preview matches the file.

Keyboard: Space plays and pauses, I and O set the start and end at the playhead, arrow keys move trim handles (Shift for 1 second steps).

## Architecture

```
src/
  app/
    page.tsx                         landing: paste a link (opens /new?url=...), demos, FAQ
    pricing/                         the plans, monthly or every 3 months (public)
    billing/                         plan & billing: plan, AI minutes this month, projects kept, Stripe portal
    new/                             import (link or upload; ?url= fills the link, ?mode=upload)
    projects/                        project list
    projects/[id]/                   source player, mark in / out, clip list
    projects/[id]/clips/[clipId]/    clip editor (preview, trim bar, inspector)
    profile/                         Clerk profile + clip defaults + notifications (which emails)
    api/
      system/status                  what this server can do (yt-dlp, ffmpeg, AI)
      sources/inspect                look up a link before importing
      projects, projects/upload      list, import from link, start an upload
      projects/[id]/...              project, upload chunks, retry, source (Range), thumb / frames,
                                     transcript, find-clips, clips, clip export and download,
                                     stop-recording, live/[file] (a followed stream's growing HLS)
      fonts/[file]                   caption fonts for the preview (the export's files) and their CSS
      billing, billing/checkout,     the user's plan (?fresh=1 reads Stripe first), a Checkout page,
      billing/portal                 a billing-portal page (optionally on switching to a plan)
      billing/webhook                Stripe's events (no session: checked by signature)
      health                         database, storage and media tools, queue depth (public; 200 or 503)
  instrumentation.ts                 runs the job worker inside the web server (unless BAMIO_WORKER=off)
  worker/main.ts                     a worker process on its own (bundled to dist/worker.mjs)
  lib/
    billing/plans.ts                 the plans: prices, minutes, projects, priority, features ("coming soon" flags)
    email/templates.ts               every email Bamio sends: its data (zod), subject, HTML and plain text
    profile/                         clip defaults and notification settings (on the Clerk user)
    clips/                           shared by browser and server: schemas (zod), time and caption
                                     maths, crop maths, ASS captions, ffmpeg arguments, URL checks, API client
    server/                          server only: auth and HTTP helpers, media tools (yt-dlp, ffprobe,
                                     ffmpeg), caption fonts per script (caption-fonts.ts + .json), plans
                                     and payments (billing.ts, the only reader of the Stripe keys), and:
      db.ts                          the Postgres client
      store.ts                       projects, transcripts, billing and usage in the database; media keys
                                     and scratch folders per project; id checks
      storage.ts                     media files: a local folder or S3-compatible (signed links, multipart uploads)
      live-media.ts                  a followed stream's growing HLS, kept in storage as it grows
      queue.ts                       the job queue (a Postgres table): enqueue, claim, lease, retry, cancel
      worker.ts                      runs queued jobs in pools, renews their leases, hands them back on stop
      jobs.ts                        what each job does (import, find clips, transcribe again, export,
                                     follow a stream), and starting or stopping them
      email.ts                       emails: the outbox (queueEmail) and the mailer that sends it through Resend
    ai/server/                       Gemini client (retries, fallback model), transcription and clip finding
workers/transcribe.mjs               on-device transcription in any language (sherpa-onnx: Whisper tiny detects the language,
                                     Silero VAD finds speech, Parakeet or Omnilingual transcribes), run as a child process
workers/transcribe-core.mjs          its pure logic (tokens to timed words in any script, caption phrases, which model
                                     for which language, Indian script repair, telling English from the
                                     video's language), unit tested
workers/speech-models.mjs            downloads and checks the speech models
  components/landing/                the landing page's link form, the bar that follows the page, and its demos
                                     (stock footage from public/landing/, footage.tsx; captions use the export's
                                     spec from lib/clips/ass.ts)
  components/site/                   the marketing pages' top bar, footer and FAQ list (landing, pricing)
  components/brand.tsx               the wordmark (its i-dot is a 9:16 frame tilted 12°) and the AI mark
  hooks/use-project.ts               polling while the server is busy (or a stream is followed)
  hooks/use-source-video.ts          plays source.mp4, or a followed stream's growing HLS with hls.js
assets/fonts/                        Bricolage Grotesque ExtraBold, burned into captions (OFL); Noto fonts for
                                     other scripts are downloaded into web/.models/fonts
db/migrate.mjs, db/migrations/      the database's tables, as numbered SQL files applied in order
scripts/                             setup-media.mjs (yt-dlp, models, fonts), check-ai.mjs, setup-stripe.mjs,
                                     landing-footage.mjs (the landing page's demo footage), db-local.mjs,
                                     db-migrate.mjs, db-import-disk.mjs, build-worker.mjs
Dockerfile, compose.yaml             one image for the web server and the worker; a stack with Postgres and MinIO
public/landing/                      the demo footage: podcast and stream loops (WebM, MP4), stills, a filmstrip
```

Key decisions:

- **Data is in Postgres** (`db/migrations`): a project (with its clips and job states) is one validated JSON document per row, changed inside a transaction with the row locked (`mutateProject`), so several servers can share it. Transcripts, billing and usage have their own tables.
- **Media is in storage** (`storage.ts`), under `users/<user>/projects/<project>/`: the server's disk by default, or S3, R2 or MinIO. With S3 the browser gets the video, frames and exports from short-lived signed links (stable for an hour, so the browser can cache them); a followed stream's playlist goes through the server, and its segments are signed links. Work in progress (downloads, renders) happens in a local scratch folder (`BAMIO_WORK_DIR`), and only finished files are stored. Ids are validated so no key or path can leave a project; every route checks the signed-in user.
- **Jobs are durable** (`queue.ts`, `worker.ts`): every import, analysis, export and followed stream is a row in a `jobs` table. Workers claim jobs (`FOR UPDATE SKIP LOCKED`, plan priority first, at most 2 running per user per pool) and hold a lease they renew every 10 s. If a worker dies, the lease runs out after 30 s and another worker takes the job over; an import resumes from what's done (a prepared video isn't prepared again). A job that fails on the network or in the tools is tried up to 3 times (waiting 30 s, then 2 minutes); bad input and time limits aren't retried, and neither is a live capture (the stream has moved on). Stop and cancel are flags the running worker sees within seconds. A worker that's stopped (SIGTERM) takes nothing new and hands its jobs back. New jobs wake workers at once (LISTEN/NOTIFY), with polling as a fallback. A Postgres queue was chosen over Redis and BullMQ: there's one less service to run, and a job is queued in the same transaction as the project change that asks for it. `queue.ts` is small enough to swap out if the volume ever needs it.
- **The web server can be the worker** (the default: one process, for development or a small server), or it can only queue jobs (`BAMIO_WORKER=off`) beside any number of worker processes (`node dist/worker.mjs`) on other machines. Either way it needs long-running Node processes (a VPS or containers), **not serverless hosting**.
- **Uploads go in 8 MB chunks**, because Next.js buffers request bodies that pass through `proxy.ts` (10 MB). Chunks are resumable.
- **Gemini sees a compact transcript.** Caption phrases are merged into lines of about 5 to 12 seconds that end at a sentence or a pause, each numbered by the second it starts at (`promptLines` in `clips-ai.ts`); the model answers with line numbers, which map back to exact phrase times, and a clip that runs long loses lines from its end rather than being cut mid-sentence (`clipTimes`). That's about half the tokens of a start and end time on every phrase. The transcript comes first and the request last, so asking again about the same video reuses Gemini's cache. Each call logs its tokens: `[bamio/ai] find clips (… lines): … in (… cached), … thinking, … out`.
- **More clips, ranked by hype.** Bamio asks for a set number of clips, about one per 1.5 (short clips) to 3.5 minutes (long) of video, up to 40 (`clipTarget`), and tells the model to fill the list, rating weaker moments lower rather than leaving them out. The model rates each clip 1 to 10 on hype (energy and emotion), hook (the first 3 seconds) and payoff; Bamio turns those into the score (`hypeScore`: 40% hype, 35% hook, 25% payoff) that best-first order sorts on. Transcription also measures how loud each second is (`src/lib/clips/loudness.ts`, kept with the transcript), and the prompt marks the loudest lines (! the top fifth, !! the top 5%, only where they stand clearly above the rest): shouting, cheering and laughter, where a stream's hype usually is.
- **Model output is untrusted.** Every Gemini answer is validated with zod and cleaned (times clamped and ordered, clips snapped to phrase edges, overlaps removed).
- **Every language is transcribed on the device.** Gemini's audio timestamps drift badly on long audio (minutes off after 20 minutes of a podcast in our tests, with whole minutes of speech left out) and the free tier allows few requests a day, so Gemini is only used once per video, to pick clips. `workers/transcribe.mjs` runs in its own Node process:
  - **Which language:** the one picked at import, or Whisper tiny (MIT, by OpenAI) listening to speech at five points of the video (right on all 12 languages tested). English only when at least 70% of what it heard is English; a video mixing English with, say, Nepali goes to the multilingual model (`engineForWindows`).
  - **English:** NVIDIA Parakeet TDT 0.6B v2 (CC-BY-4.0). On 10 minutes of a podcast it matched 92% of YouTube's words, word starts 0.05 s median, about 10x real time on a laptop CPU.
  - **24 European languages** (Spanish, French, German, Italian, Portuguese, Russian, Ukrainian, Polish, Dutch and more): Parakeet TDT 0.6B v3 (CC-BY-4.0), with punctuation and capitals. Spanish and German: 94 to 95%, about 13x real time.
  - **Every other language** (1,600+): Meta Omnilingual ASR CTC 1B (Apache-2.0), lowercase without punctuation. 90 to 97% agreement with YouTube on Hindi, Japanese, Arabic, Korean, Indonesian, Turkish and Vietnamese, about 2x real time (`BAMIO_SPEECH_MODEL=fast`: the 300M model, 2 to 7 points lower, 4 to 8x). It sometimes slips into a neighbouring Indian script (Bengali written partly in Devanagari); those letters are mapped back, since the Indian scripts share one Unicode layout.
  - **English mixed with another language** (common in Nepali and Hindi podcasts): the multilingual model writes the English in lowercase with mistakes, and sometimes spells the other language in Latin letters or another script. `repairMultilingual` fixes it stretch by stretch. A stretch with Latin letters is also transcribed by the English model, and is English where the two agree (all of it, or runs of 3+ words; a word written half in each script is compared by its romanized spelling). A stretch not in the language's own script is decoded again with up to 8 s of the video's own speech in that script around it, which keeps the model in the language. When Whisper's guess and the script disagree (Nepali once came back as Malayalam), the language is named from the transcript's common words.
  - Every word gets its time from the audio. Words in scripts without spaces (Chinese, Japanese, Thai...) come from dictionary word breaks (`Intl.Segmenter`), with Japanese endings kept on their word. "Transcribe again" appears where it would help (`retranscribeReason`: transcripts not made on the device, and multilingual ones from before the repair above); it also moves AI clips to where their words are actually spoken (`src/lib/clips/relocate.ts`).
- **Preview matches export, in every script.** The editor draws captions with the same sizes, outlines and margins as the ASS file ffmpeg burns in, with the same font files: Bricolage Grotesque for Latin, and for other scripts a Noto font (OFL; 68 files, downloaded when first needed and checksum verified). `caption-fonts.json` records which characters each font has; the export switches font per run of characters (`\fn`, resized so every font's em matches, since libass sizes a font by its full height) and the preview declares the same files with the same `unicode-range`, so both pick the same font for every character. The export uses libass's complex shaping (Indic conjuncts) and right-to-left layout. libass can't wrap text without spaces, so caption lines in those scripts are kept narrow enough to fit and long titles are broken into lines.
- **Following a live stream** (`src/lib/server/live.ts` `followLive`, `jobs.ts` `followProject`): ffmpeg reads the stream's HLS (a Twitch in-progress VOD from its start, others from as far back as their playlist goes) and writes a growing HLS of 6 s fMP4 segments into the project's `live/` folder (an EVENT playlist). The editor plays it with hls.js (`/api/projects/[id]/live/...`). Everything else that reads the video (frames, exports, captions) reads a copy of the playlist closed with ENDLIST, so ffmpeg treats what's in so far as a finished video. Captions are made in pieces of up to 10 minutes once a minute of new video is in, kept only up to a pause at least 3 s clear of the live edge (`commitPiece`), so no word is cut; AI clips are looked for every 40 minutes of speech. When the stream ends (or on "Stop following", or at 12 hours) the rest is captioned and the HLS is copied into one MP4 (no re-encoding of the picture), and the project becomes a normal video with the same timeline. A server restart while following finishes what was captured the next time the project is opened.
- **Speed** (measured on a 6-core laptop, 20 minutes of a YouTube podcast: 95 s from pasting to clips, export 13 s):
  - *Parts of a video* download only what's needed: YouTube's H.264 and AAC files carry an index of their few-second fragments (a sidx box), so `src/lib/server/dash.ts` fetches the header and the part's fragments in 8 MB ranged requests, four at a time (20 minutes in 15 s). Without an index, the whole file is downloaded and cut when that's quicker (yt-dlp fetches whole files at 16 to 35 MB/s, while a part read through ffmpeg is throttled to about 2x real time), else yt-dlp cuts it. Parts are cut at the nearest keyframe, never re-encoded.
  - *The lookup is reused:* yt-dlp's answer when a link is pasted is kept for 30 minutes and handed to the download (`--load-info-json`), saving a 7 to 9 s round trip to YouTube (a stale one is simply asked again).
  - *Transcription* decodes several speech parts at once, two threads each, sharing one loaded model (`speechCpu` in `transcribe.ts`): 1.5x faster than one part at a time (English about 20x real time, Omnilingual about 4x).
- **Links are checked** before yt-dlp sees them: http(s) only, and hosts that resolve to private or loopback addresses are refused.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run check` | Typecheck (with route types) + lint + unit tests (they start the local database if it isn't running, and use a separate `bamio_test` database) |
| `npm test` | Unit tests (Vitest): time and caption maths, timed words and phrases in any script, caption fonts, crop, clip clean-up, ASS output, ffmpeg arguments, URL safety, byte ranges, store (Postgres: locking, stalled work), storage (local, and S3 through the s3rver emulator), the job queue and worker (claims, priority, leases, retries, a crashed worker's job taken over, cancel and stop), HTTP helpers, AI helpers, live capture rules, plans and billing (prices, usage months, minutes and project limits, webhook signatures, which plan changes send which email, minutes warnings), emails (every template, escaping, the design tokens' colours, sent once per key, retries, settings, preview), queue priority |
| `npm run test:e2e` | End-to-end tests (Playwright on installed Microsoft Edge, mock AI). Reuses a server on port 3100 or starts `next dev` there. Makes a test video with ffmpeg and a committed speech track, uploads it, transcribes it on the device, finds clips (mock AI), edits, exports and checks the MP4 with ffprobe. Checks the "clips are ready" email was written (test servers preview emails, never send them). |
| `npm run setup:media` | Downloads or updates yt-dlp (re-run when a site stops working), and the speech models and caption fonts for every language (`BAMIO_PREFETCH=english` for English only; anything skipped downloads on first use) |
| `npm run ai:check` | Checks the Gemini key, JSON output and audio input on the main and fallback models |
| `npm run email:check -- you@example.com` | Sends one test email through Resend with `RESEND_API_KEY` and `EMAIL_FROM` (Resend's `delivered@resend.dev` works as a test inbox) |
| `node scripts/landing-footage.mjs` | Remakes the landing page's demo footage in `public/landing/` from two Mixkit stock videos (downloads the originals into `qa/footage-src/`) |
| `npm run db:local` | Starts the development Postgres in `web/.pg` (`-- stop`, `-- status`), and creates and updates the `bamio` and `bamio_test` databases. Needs Postgres 16+ installed (found on PATH, in `PG_BIN` or the usual install folders) |
| `npm run db:migrate` | Brings `DATABASE_URL`'s database up to date (the Docker image does this when it starts) |
| `node scripts/db-import-disk.mjs` | Copies projects, transcripts, billing and usage from the old JSON files in `BAMIO_DATA_DIR` into the database (safe to re-run) |
| `npm run build:worker` / `npm run worker` | Bundles the worker into `dist/worker.mjs` / runs it (it stops gracefully on Ctrl+C or SIGTERM) |
| `npm run seo:indexnow` | Asks Bing, Yandex and other IndexNow search engines to recrawl every page in the live sitemap (run after a deploy that changes public pages) |
| `npm run plan:grant -- you@example.com pro` | Gives a user a plan for free, for good (`none` takes it back, `-- --list` lists them). On the server: `docker compose exec app node scripts/grant-plan.mjs you@example.com pro` |
| `npm run stripe:setup` | Creates or updates the plans in Stripe (products, prices by lookup key, billing-portal settings); `-- --webhook https://your.domain` also adds the webhook endpoint. Needs Node 22.18+ (it reads `plans.ts` directly) |

Opt-in tests (`E2E_PERF=1` times an import of 20 minutes of a podcast step by step, the pages and an export; the live-stream ones also follow each stream, clip and edit while it grows, then stop; a test server started with `BAMIO_FOLLOW_MAX_BACK_SEC=300` keeps them short): `E2E_LIVE=1` imports part of a real YouTube video; `E2E_LANGUAGES=1` (or `hi,ja,ar,es`) imports real Hindi, Japanese, Arabic and Spanish videos, checks the detected language, the script and the caption fonts, and exports (preview and export frames go to `qa/languages/`); `E2E_LIVE_TWITCH` / `E2E_LIVE_YOUTUBE` / `E2E_LIVE_KICK` capture from live channels (the "capture the last minute" tests skip on a stream that keeps no history: `twitch.tv/bobross` runs around the clock but saves no VOD, so use it for following; a live Kick channel can be found at `https://kick.com/stream/featured-livestreams/en`); `E2E_LIVE_AI=1 E2E_PORT=<port>` runs real Gemini transcription against a server started without mock AI; `E2E_SCREENSHOTS=1` saves screenshots to `qa/screens/`; `E2E_RESPONSIVE=1` checks every screen (landing, pricing, import, projects, plan & billing, clip defaults, then a project and the clip editor from the uploaded sample video) at 320, 390, 768, 1024 and 1440 wide for sideways scroll, anything past the screen edge and tap targets under 24px (screenshots and `report-*.json` in `qa/responsive/`); `E2E_ADMIN=1`, against a test server started with `BAMIO_SUPERADMINS=bamio-e2e+clerk_test@example.com`, walks every admin section, gives the test user a free plan and takes it back (with `E2E_RESPONSIVE=1` it also checks the admin pages at every width; without it, the always-on admin test only checks that outsiders get a 404); `E2E_SWEEP=1` (with the same server setting, for the admin pages) opens every screen in the light and the dark theme, scrolls it so the demos animate in, and fails on any browser console error, page crash, failed request or accessibility problem (axe-core, WCAG 2.1 A and AA; screenshots and `report-*.json` in `qa/sweep/`); `E2E_BASE_URL=https://bamio.app` points the tests at another server instead of a local one, for read-only checks such as `E2E_SWEEP=1 npx playwright test sweep -g public`; `E2E_BILLING=1`, against a test server with a fake Stripe key (`STRIPE_SECRET_KEY=sk_test_e2e_fake`, which overrides a real one in `web/.env`, so nothing reaches your Stripe account; Playwright sets it on a server it starts), gives the test user a plan by writing its billing record into the server's database (`DATABASE_URL`, or the local one) and checks the gates: no plan, minutes counted, out of minutes, a subscriber's buttons on `/pricing` (screenshots in `qa/billing/`).

Tip: Next.js allows one `next dev` per project. If one is already running on port 3000, run the tests against a production build instead: `npm run build`, then `DATABASE_URL=postgres://postgres@127.0.0.1:54329/bamio BAMIO_AI_MOCK=1 BAMIO_BILLING=off BAMIO_EMAIL=preview npx next start -p 3100` (`next start` runs as production, which needs `DATABASE_URL`; plans off and emails previewed, even with Stripe and Resend keys in `web/.env`: the tests import without a plan and never send email), then `npm run test:e2e`.

## Limitations

- **Only import videos you own or have permission to use.** Some sites block downloads, need a sign-in, or limit by region; Bamio explains what went wrong, and uploading the file always works.
- **Live streams** (YouTube, Twitch, Kick and other HLS live sources) are followed or captured on the server. Following keeps the video at its source quality (about 2.7 GB an hour at 1080p60) until the stream ends, and a dropped connection ends it (start following again to carry on in a new project). How far back a capture can start depends on the stream: Twitch goes back to the start of the stream (through its in-progress VOD, when the streamer keeps past broadcasts); YouTube goes back as far as the stream's rewind (DVR) history, often an hour; Kick and other short live playlists only keep about 30 s, which every capture includes. Twitch captures from the live picture (no VOD) can include Twitch's ads.
- **Limits:** 3 hours per video (import part of a longer one), 4 GB per upload, 60 clips per project, 100 projects per user (with plans on: 50, 150 or 400), clips from 3 seconds to 3 minutes.
- **Plans:** Pricing lists as coming soon only what's next, in this order: 4K export, silence and filler-word removal, AI face tracking and custom caption styling (Pro), and team members (Team). Remove each `soon` flag in `plans.ts` as it ships; the longer wish list (B-roll, brands, scheduling, API...) was taken off the page on 2026-10-05. Prices are in US dollars; Stripe Tax isn't switched on.
- **Transcription needs CPU:** per 10 minutes of video on a 6-core laptop, about 40 seconds for English and European languages and about 3 minutes for other languages (`BAMIO_SPEECH_MODEL=fast`: about half). For everyday use, run the production server (`npm run build`, then `npm start`): pages open much faster than with `npm run dev`, which compiles each page on first visit. The models (about 1.9 GB for every language) download with `npm run setup:media`, or the first time a language needs them.
- **Captions in languages other than English and the European ones are lowercase, without punctuation** (that's how Omnilingual writes), and accuracy varies by language: excellent for widely spoken languages, rougher for some (Nepali and Bengali agreed with YouTube's own captions only 70 to 80% of the time). Captions can be fixed word by word in the editor.
- **Credits:** NVIDIA Parakeet (CC-BY-4.0: credit NVIDIA if you ship the app), Meta Omnilingual ASR (Apache-2.0), OpenAI Whisper (MIT), Silero VAD (MIT), Noto and Bricolage Grotesque fonts (OFL). The landing page's demo footage is Mixkit stock video under the Mixkit Stock Video Free License (commercial use allowed, no credit required; the footer credits it anyway): #2948 "People recording a podcast in a studio" and #43526 "Man playing an online video game on his computer", and for the gaming clip reel #51612, #5444, #45814, #5399, #45735 and #40464 (`node scripts/landing-footage.mjs reel` makes them; none shows a game people would recognise, since a famous game on screen brings its maker's trademark along). Don't put clips of real creators there without their permission.
- **Windows Smart App Control** can refuse the speech engine's unsigned DLLs for a while (it happened twice here, then allowed them again). Transcription then fails with a message saying so; try again later.
- **Emails** are in English, and there's no welcome email on sign-up (Clerk sends its own sign-up emails).
- **Rate limits are per process** (in memory): behind several web servers each one allows the full rate. Jobs, data and media are shared.

## Deploying

Bamio needs Postgres 16+, storage (a disk, or S3 / R2 / MinIO) and long-running Node processes. Workers need CPU for transcription and memory for the speech models.

- **One server with Docker** (`Dockerfile`, `compose.yaml`, `Caddyfile`; step by step for a DigitalOcean Droplet in [DEPLOY.md](DEPLOY.md)): `docker compose up -d --build` from `web/` runs Caddy (HTTPS for `DOMAIN`), Postgres and the app, which serves the site and runs the jobs, with media on the server's disk. The image builds the app and the worker, runs as a normal user, brings the database up to date when it starts, and reports health from `/api/health`. The Clerk publishable key is a build argument (it's public); everything secret is read from `.env` at run time. Not serverless: Cloudflare Workers, Vercel and the like can't run ffmpeg, yt-dlp or the speech engine.
- **More machines:** move media to S3 or R2 (`STORAGE_DRIVER=s3`), set `BAMIO_WORKER=off` on the web servers, and run the same image as workers with the command `sh -c "node scripts/setup-media.mjs && exec node dist/worker.mjs"` (a volume at `/data/models` for the speech models), all with the same `.env` and database.
- **Without Docker:** `npm ci`, `npm run setup:media`, `npm run build`, `npm run db:migrate`, then `npm start` (the web server, which also runs jobs unless `BAMIO_WORKER=off`). Optionally run `npm run build:worker` and `node dist/worker.mjs` on worker machines (same environment, same storage).
- **Health:** `GET /api/health` answers 200 when the database and storage answer (503 otherwise; "degraded" when ffmpeg or yt-dlp is missing), with the queue's depth (jobs waiting, running, and the oldest wait).
- **With S3:** browsers fetch media from the store directly. A followed stream's segments are fetched by hls.js, so the bucket's CORS must allow the site's origin for `GET` and `HEAD`. Uploads still go through the web server in 8 MB parts (a multipart upload to the store).

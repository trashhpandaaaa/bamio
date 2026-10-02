# Deploying Bamio on DigitalOcean

One Droplet runs everything with Docker (`compose.yaml`): Caddy (HTTPS for your domain, renewed automatically), Postgres, and Bamio itself (the site and the video processing). Videos, exports and the speech models are kept on the Droplet's disk.

You need: a DigitalOcean account, a domain (or see "No domain yet" below), and the keys from your `web/.env` (Clerk, Gemini; Stripe and Resend if you use them).

## 1. Create the Droplet

In DigitalOcean: **Create → Droplets**.

- **Image:** Ubuntu 24.04 (LTS) x64.
- **Size:** Basic, at least **2 vCPUs / 4 GB RAM**. 4 vCPUs / 8 GB transcribes about twice as fast; you can resize later. Disk: the plan's disk (80 GB or more) holds a lot of video.
- **Region:** the one closest to your users.
- **Authentication:** SSH key (add yours; on Windows, `ssh-keygen` in PowerShell makes one, and `type $env:USERPROFILE\.ssh\id_ed25519.pub` shows the public key to paste).
- **Backups:** worth switching on (weekly copies of the whole disk, videos included).

Note the Droplet's **IP address**.

## 2. Point your domain at it

Where your domain's DNS is managed, add an **A record**: name `bamio` (for `bamio.yourdomain.com`, or `@` for the bare domain), value the Droplet's IP.

- On **Cloudflare DNS**, set the record to **DNS only** (grey cloud), so Caddy can get the HTTPS certificate itself.
- **No domain yet?** Use `<ip-with-dashes>.sslip.io` as the domain, e.g. `203-0-113-5.sslip.io` for 203.0.113.5. It points at your IP with no setup, and HTTPS works. Clerk's production keys need a real domain, but the development keys you use now work.

## 3. Set up the server

From your computer:

```bash
ssh root@<droplet-ip>
```

Then, on the Droplet:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# 4 GB of swap, so building the app doesn't run out of memory
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Firewall: SSH and the website only
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 4. Get the code

```bash
git clone https://github.com/trashhpandaaaa/bamio.git
cd bamio/web
```

If the repository is private, git asks for a username and password: use your GitHub username, and as the password a **fine-grained personal access token** (GitHub → Settings → Developer settings → Personal access tokens) with read-only **Contents** access to this repository.

## 5. Settings

```bash
cp .env.example .env
nano .env
```

Fill in (remove the `#` in front of each line you set):

| Setting | Value |
|---|---|
| `DOMAIN` | `bamio.yourdomain.com` (no `https://`) |
| `POSTGRES_PASSWORD` | a long random password: run `openssl rand -hex 24` and paste the result |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | from your local `web/.env` (the other Clerk lines can come too) |
| `GEMINI_API_KEY` | your key |
| Stripe, Resend | optional; leave them out at first and plans and emails stay off |

Don't copy `BAMIO_AI_MOCK`, `BAMIO_BILLING=off`, `BAMIO_EMAIL` or `DATABASE_URL` from your laptop: `compose.yaml` sets what the server needs. Save with Ctrl+O, Enter, then Ctrl+X.

## 6. Start it

```bash
docker compose up -d --build
```

The first build takes 5 to 10 minutes. Then:

```bash
docker compose ps                  # app, postgres and caddy: running (app: healthy after a minute)
docker compose logs -f app         # the app's log (Ctrl+C to stop watching)
docker compose exec app node scripts/setup-media.mjs   # download the speech models now (~1.9 GB), not on the first import
```

Open `https://bamio.yourdomain.com`, sign in and import a video. `https://bamio.yourdomain.com/api/health` should say `"status":"ok"`.

## 7. Before real users

- **Clerk:** in the Clerk dashboard, create a **production instance** for your domain (it asks you to add a few DNS records), and put its `pk_live_...` and `sk_live_...` keys in `.env`. The publishable key is built into the pages, so rebuild: `docker compose up -d --build`.
- **Stripe:** put your live key in `.env` as `STRIPE_SECRET_KEY`. On your own computer, in `web/`, run `STRIPE_SECRET_KEY=sk_live_... npm run stripe:setup -- --webhook https://bamio.yourdomain.com` (in PowerShell: `$env:STRIPE_SECRET_KEY="sk_live_..."; npm run stripe:setup -- --webhook https://bamio.yourdomain.com`). It prints a webhook signing secret: put it in the server's `.env` as `STRIPE_WEBHOOK_SECRET`, then `docker compose up -d`.
- **Resend:** verify your domain at resend.com/domains, add `RESEND_API_KEY` and `EMAIL_FROM` to `.env`, run `docker compose up -d`, then test: `docker compose exec app node scripts/check-email.mjs you@example.com`.

## Your own account

To use Bamio yourself without paying (once plans are on), sign up on the site, then on the Droplet:

```bash
docker compose exec app node scripts/grant-plan.mjs trashhpandaaaa@gmail.com pro
```

It finds the account in Clerk by email (so it has to exist on this site, with the same Clerk keys) and gives it Pro for good. `none` instead of `pro` takes it back; `--list` shows who has a free plan. If you switch to Clerk's production keys later, sign up again on the live site and run it again: development and production accounts are different users.

## YouTube links

YouTube asks servers in data centres to sign in ("confirm you're not a bot"), so YouTube links fail on the Droplet until Bamio has a signed-in YouTube session. Give it the cookies of a **spare Google account** (not your main one: YouTube may block an account that downloads a lot).

1. On your computer, open a **private / incognito window** and sign in to YouTube with the spare account.
2. In that same window, go to `https://www.youtube.com/robots.txt` (so no other tab touches the session).
3. Export the cookies for youtube.com in Netscape format with a cookies.txt extension (for example "Get cookies.txt LOCALLY" for Chrome or Edge, or "cookies.txt" for Firefox; extensions must be allowed in private windows). Save it as `youtube-cookies.txt`.
4. **Close the private window** without signing out, so YouTube doesn't replace the session.
5. Copy it to the server and give it to the app:
   ```bash
   scp youtube-cookies.txt root@<droplet-ip>:/root/        # from your computer
   # then on the Droplet, in /opt/bamio/web (or wherever you cloned it):
   docker compose cp /root/youtube-cookies.txt app:/data/youtube-cookies.txt
   docker compose exec -u root app chown bamio /data/youtube-cookies.txt
   rm /root/youtube-cookies.txt
   grep -q '^YTDLP_COOKIES=' .env || echo 'YTDLP_COOKIES=/data/youtube-cookies.txt' >> .env
   docker compose up -d
   ```

The file stays on the server's volume across updates. The cookies last weeks to months; when YouTube links start failing with the sign-in message again (the app log says so: `docker compose logs app | grep YTDLP_COOKIES`), export new ones and repeat step 5.

## Updating

After pushing changes to GitHub:

```bash
cd ~/bamio && git pull && cd web && docker compose up -d --build
```

The database is updated automatically when the app starts. Imports that are running are handed back and resume after the restart.

## Backups

Droplet backups copy everything weekly. For a daily copy of the database (projects, plans, usage) as well:

```bash
mkdir -p ~/backups
crontab -e
# add this line, then save:
0 3 * * * cd ~/bamio/web && docker compose exec -T postgres pg_dump -U bamio bamio | gzip > ~/backups/bamio-$(date +\%F).sql.gz && find ~/backups -name '*.sql.gz' -mtime +14 -delete
```

## When something's wrong

- **The site doesn't load / no HTTPS:** `docker compose logs caddy`. Usually the domain doesn't point at the Droplet yet (DNS can take a few minutes), or Cloudflare's proxy (orange cloud) is on.
- **The app keeps restarting:** `docker compose logs app`. A missing setting in `.env` is named there.
- **YouTube links fail with "confirm you're not a bot":** set up YouTube links (above), or export fresh cookies if they've expired. Uploads always work; Twitch and Kick are usually fine.
- **Out of memory while transcribing:** resize the Droplet to 8 GB (Droplet → Resize), then `docker compose up -d`.
- **Disk filling up:** `df -h`. Old projects can be deleted in the app; or resize the Droplet's disk.

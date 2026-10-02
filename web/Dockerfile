# syntax=docker/dockerfile:1.7
#
# Bamio: one image for the web server and the media worker; they differ by command (see
# compose.yaml). From web/:
#   docker build --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_... -t bamio .
# The Clerk publishable key is built into the pages (it's public); everything secret comes in
# at run time (CLERK_SECRET_KEY, GEMINI_API_KEY, STRIPE_*, DATABASE_URL, S3_*).

ARG NODE_VERSION=24.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Build: the Next.js app and the worker bundle (dev dependencies included).
FROM base AS build
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:worker

# Runtime packages only (ffmpeg and ffprobe come with them; so do the speech engine's Linux libraries).
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    BAMIO_DATA_DIR=/data/media \
    BAMIO_WORK_DIR=/data/work \
    BAMIO_MODELS_DIR=/data/models
# ca-certificates: https (yt-dlp, model downloads, Stripe, S3). tini: signals reach node, so a
# stopping worker hands its jobs back.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 bamio \
 && mkdir -p /data/media /data/work /data/models \
 && chown -R bamio /app /data
USER bamio
COPY --chown=bamio package.json package-lock.json next.config.ts tsconfig.json ./
COPY --from=deps --chown=bamio /app/node_modules ./node_modules
COPY --from=build --chown=bamio /app/.next ./.next
COPY --from=build --chown=bamio /app/dist ./dist
COPY --chown=bamio public ./public
COPY --chown=bamio assets ./assets
COPY --chown=bamio workers ./workers
COPY --chown=bamio db ./db
COPY --chown=bamio scripts ./scripts
COPY --chown=bamio src/lib/server/caption-fonts.json ./src/lib/server/caption-fonts.json
# yt-dlp into /app/.bin (re-run `node scripts/setup-media.mjs` in the container to update it).
# The speech models (about 1.9 GB) go to the /data/models volume when a worker first starts.
RUN BAMIO_PREFETCH=none node scripts/setup-media.mjs

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# The web server: brings the database up to date, then serves. Workers run `node dist/worker.mjs`.
CMD ["sh", "-c", "node scripts/db-migrate.mjs && exec node node_modules/next/dist/bin/next start -p ${PORT}"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

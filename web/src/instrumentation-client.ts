/*
 * Errors in the browser go to Sentry when NEXT_PUBLIC_SENTRY_DSN was set at build time (in
 * Docker, a build argument: compose.yaml passes it from .env). The SDK loads on its own, after
 * the page, and only then: without a DSN nothing is downloaded. Error reports only: no
 * performance tracing, no session replays.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs")
    .then((Sentry) =>
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV === "production" ? "production" : "development",
        // Nothing personal: no cookies, headers, bodies, query strings or user details.
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
        tracesSampleRate: 0,
        // Noise from browser extensions and from pages left open over a deploy.
        ignoreErrors: ["ResizeObserver loop", "Non-Error promise rejection captured", "ChunkLoadError", /Loading chunk [\d]+ failed/],
        denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-web-extension:\/\//],
      }),
    )
    .catch(() => undefined);
}

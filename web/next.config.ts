import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let the dev server be opened as 127.0.0.1 as well as localhost (dev-only setting).
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Build workers by free memory (at least 4), not one per CPU: with 11 on a busy 8 GB machine the build ran out of memory.
    memoryBasedWorkersCount: true,
  },
  // Runtime data, speech models, downloaded tools and QA files are never part of the build.
  // (Webpack's tracer ignores the /*turbopackIgnore*/ hints in server code, so say it here too.)
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.models/**/*", "./.bin/**/*", "./qa/**/*", "./test-results/**/*"],
  },
  // Addresses people (and search engines) guess, to the real pages, instead of a 404.
  async redirects() {
    return [
      { source: "/login", destination: "/sign-in", permanent: true },
      { source: "/signin", destination: "/sign-in", permanent: true },
      { source: "/signup", destination: "/sign-up", permanent: true },
      { source: "/register", destination: "/sign-up", permanent: true },
      { source: "/home", destination: "/", permanent: true },
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/plans", destination: "/pricing", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Browsers that have seen Bamio over HTTPS use only HTTPS for a year (ignored on http://localhost).
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      {
        // The landing page's demo footage changes rarely (scripts/landing-footage.mjs): browsers and
        // Cloudflare keep it a week, and use a stale copy for a day while fetching a new one.
        source: "/landing/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;

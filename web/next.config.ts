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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/*
 * App pages need a signed-in user. The landing page, sign-in and sign-up stay public.
 * AI API routes check the session themselves (see src/lib/ai/server/route.ts) so they
 * can answer with JSON 401 instead of a redirect.
 */

const isAppPage = createRouteMatcher(["/projects(.*)", "/new(.*)", "/profile(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isAppPage(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk's auto-proxy path
    "/__clerk/:path*",
  ],
};


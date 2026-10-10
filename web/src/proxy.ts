import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/*
 * App pages need a signed-in user. The landing page, pricing, sign-in and sign-up stay
 * public. API routes check the session themselves (userRoute in src/lib/server/http.ts) so
 * they can answer with JSON 401 instead of a redirect; Stripe's webhook has no session and
 * is checked by its signature.
 */

const isAppPage = createRouteMatcher(["/projects(.*)", "/new(.*)", "/editor(.*)", "/download(.*)", "/profile(.*)", "/billing(.*)"]);

export default clerkMiddleware(
  async (auth, req) => {
    if (isAppPage(req)) await auth.protect();
  },
  // Signed-out visitors go to Bamio's own sign-in page.
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

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


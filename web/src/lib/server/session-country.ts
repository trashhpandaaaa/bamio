import "server-only";
import { countryCode } from "@/lib/campaigns/regions";

/*
 * The country the signed-in user's session is in, as Clerk worked it out from the session's IP
 * address (Clerk sees it at every sign-in; Bamio keeps only the country). A hint for admins
 * about campaign clippers, never shown to anyone else and never a reason to refuse anything,
 * so it gives null rather than fail.
 */
export async function sessionCountry(): Promise<string | null> {
  try {
    const { auth, clerkClient } = await import("@clerk/nextjs/server");
    const { sessionId } = await auth();
    if (!sessionId) return null;
    const session = await (await clerkClient()).sessions.getSession(sessionId);
    return countryCode(session.latestActivity?.country);
  } catch {
    return null;
  }
}

import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { requestAccountDeletion } from "@/lib/server/accounts";
import { errorResponse, HttpError } from "@/lib/server/http";

/**
 * Clerk's webhook (Svix). Not a userRoute: Clerk calls it, with no session, and its signature
 * (checked with CLERK_WEBHOOK_SIGNING_SECRET) is the proof. user.deleted (an account deleted in
 * Clerk's dashboard, or anywhere but the profile) deletes everything Bamio keeps about the user,
 * and ends their subscription. An error answer makes Clerk send the event again later.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 1024 * 1024) throw new HttpError(413, "too_large", "That request is too large.");
    let event;
    try {
      event = await verifyWebhook(req);
    } catch {
      throw new HttpError(400, "bad_signature", "The webhook signature doesn’t match.");
    }
    if (event.type === "user.deleted" && event.data.id) await requestAccountDeletion(event.data.id, "clerk");
    return Response.json({ received: true });
  } catch (err) {
    return errorResponse(err);
  }
}

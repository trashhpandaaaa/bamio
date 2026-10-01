import { handleWebhook, verifyWebhook } from "@/lib/server/billing";
import { errorResponse, HttpError } from "@/lib/server/http";

/**
 * Stripe's webhook. Not a userRoute: Stripe calls it, with no session, and its signature over
 * the raw body (checked with STRIPE_WEBHOOK_SECRET) is the proof. An error answer makes Stripe
 * send the event again later.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 1024 * 1024) throw new HttpError(413, "too_large", "That request is too large.");
    const event = verifyWebhook(await req.text(), req.headers.get("stripe-signature"));
    await handleWebhook(event);
    return Response.json({ received: true });
  } catch (err) {
    return errorResponse(err);
  }
}

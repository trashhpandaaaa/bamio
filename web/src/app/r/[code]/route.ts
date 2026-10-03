import { codeOwner, isReferralCode, REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS } from "@/lib/server/referrals";

/**
 * A referral link: bamio.app/r/<code>. Keeps the code in a cookie (60 days, read at checkout)
 * and goes to the home page. Public, like any link someone shares; an unknown code just goes home.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
  const owner = isReferralCode(code) ? await codeOwner(code).catch(() => null) : null;
  if (owner) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    headers.append("Set-Cookie", `${REFERRAL_COOKIE}=${code}; Path=/; Max-Age=${REFERRAL_COOKIE_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure}`);
  }
  return new Response(null, { status: 307, headers });
}

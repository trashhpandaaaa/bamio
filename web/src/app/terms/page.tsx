import Link from "next/link";
import type { Metadata } from "next";
import { ContactEmail, LegalPage, legalMetadata } from "@/components/site/legal-page";
import { formatPrice, FREE_TRIAL, REFERRAL_REWARD_CENTS } from "@/lib/billing/plans";
import { COMPANY } from "@/lib/legal";

const title = "Terms of service";
const description = "The terms for using Bamio: your account, which videos you may clip, your content, plans and payments, and what each side is responsible for.";

export const metadata: Metadata = legalMetadata({ title, description, path: "/terms" });

export default function TermsPage() {
  return (
    <LegalPage title={title} lede="The agreement between you and Bamio when you use it. Plain words where we could; please read it." path="/terms">
      <section>
        <h2>1. Who we are</h2>
        <p>
          Bamio is run by {COMPANY.name}, a company registered in {COMPANY.country} ({COMPANY.address}). In these terms, “Bamio”, “we” and “us” mean that company; “you”
          means the person using Bamio. Questions about these terms: <ContactEmail />.
        </p>
      </section>

      <section>
        <h2>2. Agreeing to these terms</h2>
        <p>
          By creating an account or using Bamio you agree to these terms and to our <Link href="/privacy">privacy policy</Link>. You must be at least 16 years old, or
          the age at which you can agree to them where you live, if that is higher. If you use Bamio for a business, you agree for that business, and confirm you may.
        </p>
      </section>

      <section>
        <h2>3. Your account</h2>
        <ul>
          <li>Keep your sign-in details to yourself. You are responsible for what happens in your account.</li>
          <li>One account per person. Don’t make more accounts to get more free minutes.</li>
          <li>Tell us at <ContactEmail /> if you think someone else is using your account.</li>
        </ul>
      </section>

      <section>
        <h2>4. Which videos you may clip</h2>
        <p>
          <strong>Only videos you own or have permission to use.</strong> When you paste a link, Bamio downloads that video for you; when you upload a file, it stores
          it. You are responsible for having the rights to every video you import and every clip you make and share, and for following the rules of the sites you
          import from and post to.
        </p>
        <p>
          Bamio doesn’t publish your videos. What you import stays in your account, visible only to you, until you delete it; clips leave Bamio only when you download
          them. If a rights holder tells us you used Bamio for their work without permission, we may remove it and close your account (see{" "}
          <Link href="/takedown">copyright and takedowns</Link>).
        </p>
      </section>

      <section>
        <h2>5. Your content</h2>
        <p>
          You keep every right you have in your videos, transcripts and clips. You let us store, copy, transcribe, analyse and render them only to run Bamio for you:
          finding clips, captioning, exporting and keeping your projects. That permission ends when you delete them or your account.
        </p>
        <p>
          Bamio transcribes speech on its own servers. To find clips it sends the transcript’s text (not the video) to Google’s Gemini API. We don’t sell your content
          and don’t use it to advertise.
        </p>
      </section>

      <section>
        <h2>6. Using Bamio fairly</h2>
        <p>Don’t use Bamio to:</p>
        <ul>
          <li>break the law, or infringe anyone’s copyright, privacy or other rights;</li>
          <li>process content that sexualises minors, promotes violence or harassment, or is otherwise illegal;</li>
          <li>overload, probe or get around Bamio’s limits, security or payments, or copy the service with automated tools;</li>
          <li>resell Bamio, or share an account between people.</li>
        </ul>
        <p>We may suspend or close an account that does, and remove what it holds.</p>
      </section>

      <section>
        <h2>7. Trying Bamio</h2>
        <p>
          A new account can process its first video free, up to {FREE_TRIAL.minutes} minutes of video, once per person, with every feature included. It ends when the
          minutes are used or you choose a plan. We may change or end the free trial for new accounts at any time.
        </p>
      </section>

      <section>
        <h2>8. Plans and payments</h2>
        <ul>
          <li>
            Plans and their prices are on the <Link href="/pricing">pricing page</Link>, in US dollars. Stripe handles payments; we never see or store your card.
          </li>
          <li>
            A plan is paid in advance, monthly or every 3 months, and renews automatically until you cancel it. Cancel any time under Plan &amp; billing: the plan then
            works until the end of the period you paid for.
          </li>
          <li>
            Each plan includes AI minutes (minutes of video processed) every month. Unused minutes don’t carry over. Features marked “coming soon” aren’t part of the
            plan until they’re released.
          </li>
          <li>
            Payments aren’t refunded for time or minutes left, except where the law says otherwise. If a payment fails, Stripe tries again; if it keeps failing the plan
            stops.
          </li>
          <li>We may change prices. A new price applies to you from your next renewal after we tell you, and you can cancel before then.</li>
          <li>Prices don’t include taxes that may apply where you live.</li>
          <li>
            Referral rewards ({formatPrice(REFERRAL_REWARD_CENTS)} for each friend whose first payment goes through) are credit on your Bamio bill, have no cash value
            and can be withdrawn if they were gained by abuse.
          </li>
        </ul>
      </section>

      <section>
        <h2>9. Clipping campaigns</h2>
        <ul>
          <li>
            A <Link href="/clippers">campaign</Link> is an offer from its owner (a creator or a brand) to pay clippers for views on clips of their content, at the rate
            and up to the budget on its page. Bamio lists campaigns, counts views and shows what was earned and paid.
          </li>
          <li>
            The campaign’s owner pays clippers directly. No money passes through Bamio, and Bamio isn’t a party to that payment: we don’t guarantee it and aren’t
            responsible if an owner pays late or not at all.
          </li>
          <li>
            Send only clips you posted yourself, on your own channel, that follow the campaign’s rules. Bought, botted or otherwise faked views don’t count. We may
            reject a clip, correct a view count or remove someone from campaigns.
          </li>
          <li>
            A clip counts once our team has approved it. Clips earn in the order they were approved, until the budget is used or the campaign ends. A campaign’s terms
            can change or end early; what was already paid stays paid.
          </li>
          <li>You’re responsible for any tax on what you earn.</li>
        </ul>
      </section>

      <section>
        <h2>10. Ending</h2>
        <p>
          You can delete your account at any time from your profile (Delete account). That ends your plan at once, with no refund for the time left, and deletes your
          projects, videos and clips for good. We may suspend or close your account if you break these terms, or if we stop offering Bamio; when we stop offering it, we
          will tell you in advance where we can, so you can download your clips.
        </p>
      </section>

      <section>
        <h2>11. The service as it is</h2>
        <p>
          We work to keep Bamio running and your projects safe, but we provide it as it is and as available. AI picks moments and writes captions that can be wrong:
          check clips before you post them. Keep your own copies of anything important. We may change, add or remove features.
        </p>
      </section>

      <section>
        <h2>12. Responsibility</h2>
        <p>
          As far as the law allows, we are not liable for indirect or consequential losses (such as lost profits, revenue or data), and our total liability to you for
          anything to do with Bamio is limited to what you paid us in the 12 months before the claim. Nothing in these terms limits liability that the law doesn’t let
          us limit, or your rights as a consumer.
        </p>
        <p>
          You are responsible for the videos you import and the clips you make: if a claim against us arises from them, or from your breaking these terms, you will cover
          its reasonable costs.
        </p>
      </section>

      <section>
        <h2>13. Changes and law</h2>
        <p>
          We may update these terms. For changes that matter, we will tell you by email or in Bamio before they apply; if you keep using Bamio after that, the new terms
          apply. These terms are governed by the law of {COMPANY.country}, and its courts decide disputes, except where the law where you live gives you the right to
          bring a case there.
        </p>
      </section>

      <section>
        <h2>14. Contact</h2>
        <p>
          {COMPANY.name}, {COMPANY.address}, {COMPANY.country}. Email: <ContactEmail />.
        </p>
      </section>
    </LegalPage>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { ContactEmail, LegalPage, legalMetadata } from "@/components/site/legal-page";
import { COMPANY } from "@/lib/legal";

const title = "Privacy policy";
const description = "What Bamio keeps about you and your videos, why, who helps run it, how long it stays, and how to see or delete it.";

export const metadata: Metadata = legalMetadata({ title, description, path: "/privacy" });

export default function PrivacyPage() {
  return (
    <LegalPage title={title} lede="What Bamio keeps about you, why, and how to see or delete it. We keep only what running Bamio needs." path="/privacy">
      <section>
        <h2>Who is responsible</h2>
        <p>
          {COMPANY.name} ({COMPANY.address}, {COMPANY.country}) runs Bamio and is responsible for your personal data in it. Privacy questions and requests:{" "}
          <ContactEmail />.
        </p>
      </section>

      <section>
        <h2>What we keep</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your name, username, email address, profile picture and how you sign in (password, Google or Apple). Clerk keeps these for
            us.
          </li>
          <li>
            <strong>Your videos and projects:</strong> the videos you upload, the videos Bamio downloads from links you paste, their transcripts, the clips you make and
            their exports, your edits and your clip settings.
          </li>
          <li>
            <strong>Downloads:</strong> the link you paste into the downloader, and the video Bamio’s server fetches from that site for you. The file is kept for 24
            hours so you can save it, then deleted; taking it off your list deletes it at once. The site the video comes from sees Bamio’s server, not your device.
          </li>
          <li>
            <strong>The editor</strong> is the exception: videos, photos and sounds you open in it stay on your device. They are read, edited and exported in your
            browser, the edit is saved in your browser’s own storage, and none of it is sent to Bamio. Clearing the browser’s data for this site deletes them.
          </li>
          <li>
            <strong>Your plan:</strong> which plan you have, its renewal date, the AI minutes you used and your Stripe customer number. Your card is entered on Stripe’s
            page and its number never reaches us. For the free first video Stripe checks a card and tells us its brand, its last four digits and a fingerprint (a code
            that is the same for the same card), so that a card starts one free trial only.
          </li>
          <li>
            <strong>Referrals:</strong> your referral code, who signed up with it, and the credit it earned. A link someone shares with you leaves a cookie for 60 days
            so the referral counts.
          </li>
          <li>
            <strong>Clipping campaigns,</strong> only if you join one: the name and channel link you give, your profile picture, the links to the clips you send, their
            view counts and what they earned. Your name, picture, channel and those numbers are shown on the leaderboard of a{" "}
            <Link href="/clippers">campaign</Link> once a clip of yours is approved, to the people who can open it: accounts with a Bamio plan, the campaign’s owner
            and our team. A campaign’s owner pays Bamio, and Bamio pays the clippers. How you want to be paid is seen only by our team, who pay you with it; a campaign’s owner
            never sees it. We keep a record of each payment we make to you. If you ask to run a campaign: what you tell us about
            it (your show, channel or business, the link to your content, the rate and the budget) and your account’s email, seen by our team; the
            campaign’s name and terms are on its page once it opens, for accounts with a Bamio plan.
          </li>
          <li>
            <strong>Emails we sent you:</strong> which email, when, and whether it was delivered.
          </li>
          <li>
            <strong>Technical data:</strong> IP address, browser and device in server logs; error reports when something breaks (the page, the error and your user
            number, not your videos).
          </li>
        </ul>
      </section>

      <section>
        <h2>Why</h2>
        <ul>
          <li>To run Bamio for you: import, transcribe, find clips, edit and export. This is the contract between us.</li>
          <li>To take payments and keep the records the law asks for.</li>
          <li>
            To email you about your videos and your plan. Emails about videos and minutes can be turned off under Profile, Notifications; emails about payments can’t.
          </li>
          <li>To keep Bamio secure, stop abuse and fix errors. This is our legitimate interest in a working, safe service.</li>
        </ul>
        <p>
          We don’t sell your data. Bamio shows ads from Google AdSense; what that means for you is under “Ads” below. Bamio doesn’t give your videos, transcripts
          or clips to Google for them.
        </p>
      </section>

      <section>
        <h2>Who helps run Bamio</h2>
        <p>These companies process data for us, only to provide their part of Bamio:</p>
        <ul>
          <li>
            <strong>DigitalOcean</strong>: the servers and storage Bamio runs on, in the United States.
          </li>
          <li>
            <strong>Cloudflare</strong>: delivers the site, protects it from attacks and counts visits without cookies.
          </li>
          <li>
            <strong>Clerk</strong>: accounts and sign-in.
          </li>
          <li>
            <strong>Stripe</strong>: payments, invoices and subscriptions.
          </li>
          <li>
            <strong>Google (Gemini API)</strong>: receives the text of a transcript to pick the clips. Bamio transcribes on its own servers; the video itself isn’t
            sent.
          </li>
          <li>
            <strong>Resend</strong>: sends Bamio’s emails.
          </li>
          <li>
            <strong>Google (AdSense)</strong>: shows the ads. Its script loads with Bamio’s pages, so Google sees your IP address, your browser and which page you’re
            on. See “Ads” below.
          </li>
          <li>
            <strong>Sentry</strong>: error reports.
          </li>
        </ul>
        <p>
          When you paste a link, Bamio downloads the video from that site (YouTube, Twitch, Kick and others), whose own privacy policy applies to what they log. For
          a clip you send to a campaign, Bamio reads the post’s public page (its view count, title and account name) on TikTok or YouTube. Some of
          these companies are outside your country, including in the United States; where the law requires it, transfers are covered by standard contractual clauses or
          an equivalent safeguard.
        </p>
      </section>

      <section>
        <h2>How long it stays</h2>
        <ul>
          <li>Projects, videos and clips: until you delete them, or your account.</li>
          <li>Videos from the downloader: 24 hours, or until you take them off your list. The record that a download was made: three days.</li>
          <li>Your account, plan and usage: while you have the account.</li>
          <li>The record of emails sent: 180 days.</li>
          <li>Database backups: 14 days, after which deleted data is gone from them too.</li>
          <li>Invoices and payment records: kept by Stripe as long as tax and accounting law requires.</li>
        </ul>
      </section>

      <section>
        <h2>Your choices and rights</h2>
        <ul>
          <li>See and correct your details under Profile.</li>
          <li>Download your clips at any time.</li>
          <li>Change your clipper name, channel and payout details under Profile, Clipper details. Take back a clip you sent to a campaign while it’s still waiting.</li>
          <li>
            <strong>Delete your account</strong> under Profile, Delete account: it ends your plan and deletes your projects, videos, clips and records at once (and from
            backups within 14 days). Two things stay, tied to nothing else: the fact that the account was deleted, and the fingerprint of the card a free trial was
            started with, so the same card can’t start another.
          </li>
          <li>
            Ask for a copy of your data, or object to or limit how we use it, at <ContactEmail />. We answer within a month.
          </li>
        </ul>
        <p>
          If you live in the EU, the UK or somewhere with similar law, you have these rights by law, and you can also complain to your data protection authority.
        </p>
      </section>

      <section>
        <h2>Cookies and storage in your browser</h2>
        <ul>
          <li>Clerk’s cookies keep you signed in.</li>
          <li>The referral cookie (60 days) remembers which link brought you.</li>
          <li>Your theme (light or dark) is saved in your browser.</li>
          <li>Stripe sets its own cookies on its payment pages, to prevent fraud.</li>
          <li>Google sets cookies for the ads (see “Ads”). Those are the only ones here for advertising.</li>
        </ul>
      </section>

      <section>
        <h2>Ads</h2>
        <p>
          Bamio shows ads through Google AdSense. Google and the advertisers it works with use cookies to show and measure ads, and to choose them from your visits
          to this site and to other sites. That’s how an ad here can be about something you looked at elsewhere.
        </p>
        <ul>
          <li>
            You can switch off personalised ads in{" "}
            <a href="https://www.google.com/settings/ads" rel="noopener noreferrer">
              Google’s Ads Settings
            </a>
            , and for other advertising companies at{" "}
            <a href="https://www.aboutads.info/choices/" rel="noopener noreferrer">
              aboutads.info
            </a>
            . You’ll still see ads; they just won’t be chosen from what you’ve done.
          </li>
          <li>
            <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">
              How Google uses information from sites that use its services
            </a>
            .
          </li>
        </ul>
        <p>Bamio doesn’t send your videos, transcripts, clips or edits to Google for ads, and files you open in the editor never leave your device.</p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Bamio isn’t for anyone under 16. If you think a child has given us their data, tell us and we will delete it.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          When this policy changes in a way that matters, we will tell you by email or in Bamio before it applies. The <Link href="/terms">terms of service</Link> cover
          the rest of how Bamio works.
        </p>
      </section>
    </LegalPage>
  );
}

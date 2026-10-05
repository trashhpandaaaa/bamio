import Link from "next/link";
import type { Metadata } from "next";
import { ContactEmail, LegalPage, legalMetadata } from "@/components/site/legal-page";

const title = "Copyright and takedowns";
const description = "How to report your work being used on Bamio without permission, what we do about it, and how to answer a report about your clips.";

export const metadata: Metadata = legalMetadata({ title, description, path: "/takedown" });

export default function TakedownPage() {
  return (
    <LegalPage title={title} lede="Bamio is for clipping videos you own or have permission to use. Here is how to tell us when someone didn’t." path="/takedown">
      <section>
        <h2>Where videos made with Bamio live</h2>
        <p>
          Bamio doesn’t publish videos. What someone imports stays in their private account, and clips leave Bamio only when that person downloads them and posts them
          somewhere else. If a clip of your work is up on YouTube, TikTok, Instagram or another site, report it to that site too: only they can take it down there.
        </p>
      </section>

      <section>
        <h2>Reporting your work</h2>
        <p>
          If you think someone used Bamio to copy your work without permission, or you see your work on Bamio’s own pages, email <ContactEmail /> with:
        </p>
        <ol>
          <li>your name, address, phone number and email address;</li>
          <li>the work you own, and where the original is (a link, if it’s online);</li>
          <li>where the copy is: a link to the clip or the video it came from, and anything else that helps us find it;</li>
          <li>this statement: “I believe in good faith that this use isn’t authorised by the owner, its agent or the law.”;</li>
          <li>
            this statement: “The information in this notice is accurate, and under penalty of perjury, I am the owner, or authorised to act for the owner, of the
            rights said to be infringed.”;
          </li>
          <li>your signature (your typed full name is enough).</li>
        </ol>
      </section>

      <section>
        <h2>What we do</h2>
        <ul>
          <li>We read every complete notice, usually within two working days.</li>
          <li>If it holds, we remove or disable the material in the account, and tell its owner, with a copy of the notice.</li>
          <li>We close the accounts of people who infringe again and again.</li>
        </ul>
      </section>

      <section>
        <h2>If a report is about your clips</h2>
        <p>
          If you think material was removed by mistake, or you have the rights to it, reply to <ContactEmail /> with your name and contact details, what was removed,
          a statement under penalty of perjury that you believe it was removed by mistake or misidentification, your consent to the courts where you live (or ours, if
          you live outside the country), and your signature. We pass it on to the person who reported it, and may restore the material unless they start a court case
          within 14 working days.
        </p>
        <p>
          Sending a false report or reply on purpose can make you liable for the harm it causes. See also our <Link href="/terms">terms of service</Link>.
        </p>
      </section>
    </LegalPage>
  );
}

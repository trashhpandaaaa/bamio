"use client";

import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { useSystemStatus } from "@/hooks/use-project";

/*
 * The marketing pages' links that depend on who is looking. They're decided in the browser,
 * so the pages themselves stay static: built once and served as they are, with nothing read
 * from the session (or the server's settings) on the way.
 */

/** "Your projects", for signed-in visitors (the bar and the menu). */
export function ProjectsLink() {
  return (
    <Show when="signed-in">
      <Link href="/projects">Your projects</Link>
    </Show>
  );
}

/** "Sign in", for visitors who aren't (the menu). */
export function SignInLink() {
  return (
    <Show when="signed-out">
      <Link href="/sign-in">Sign in</Link>
    </Show>
  );
}

/** The footer's "Your account" list. */
export function FooterAccountLinks() {
  return (
    <>
      <Show when="signed-out">
        <li>
          <Link href="/sign-in">Sign in</Link>
        </li>
        <li>
          <Link href="/sign-up">Sign up</Link>
        </li>
      </Show>
      <Show when="signed-in">
        <li>
          <Link href="/projects">Your projects</Link>
        </li>
        <li>
          <Link href="/new">Import a video</Link>
        </li>
        <li>
          <Link href="/profile/clip-defaults">Clip defaults</Link>
        </li>
        <BillingLink />
      </Show>
    </>
  );
}

/** "Plan & billing", where plans are on. Mounted only for signed-in visitors (the status needs a session). */
function BillingLink() {
  const billing = useSystemStatus()?.billing ?? false;
  return billing ? (
    <li>
      <Link href="/billing">Plan &amp; billing</Link>
    </li>
  ) : null;
}

"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { CreditCard, Gift, Scissors } from "@phosphor-icons/react";
import { useSystemStatus } from "@/hooks/use-project";

/** Sign in / sign up when signed out; the account menu (edit profile, clip defaults, plan, sign out) when signed in. */
export function AuthControls() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton>
          <button className="btn btn-ghost btn-sm" type="button">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton>
          <button className="btn btn-primary btn-sm" type="button">
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <AccountMenu />
      </Show>
    </>
  );
}

function AccountMenu() {
  // "Plan & billing" only where plans are on (STRIPE_SECRET_KEY on the server).
  const billing = useSystemStatus()?.billing ?? false;
  return (
    // "Manage account" is renamed "Edit profile" (see clerk-appearance.ts) and opens /profile.
    <UserButton userProfileMode="navigation" userProfileUrl="/profile">
      <UserButton.MenuItems>
        <UserButton.Action label="manageAccount" />
        <UserButton.Link label="Clip defaults" labelIcon={<Scissors size={16} />} href="/profile/clip-defaults" />
        {billing ? <UserButton.Link label="Plan & billing" labelIcon={<CreditCard size={16} />} href="/billing" /> : null}
        {billing ? <UserButton.Link label="Refer a friend" labelIcon={<Gift size={16} />} href="/billing#refer" /> : null}
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
    </UserButton>
  );
}

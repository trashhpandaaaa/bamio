"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { FilmSlate } from "@phosphor-icons/react";

/** Sign in / sign up when signed out; the account menu (edit profile, video defaults, sign out) when signed in. */
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
        {/* "Manage account" is renamed "Edit profile" (see clerk-appearance.ts) and opens /profile. */}
        <UserButton userProfileMode="navigation" userProfileUrl="/profile">
          <UserButton.MenuItems>
            <UserButton.Action label="manageAccount" />
            <UserButton.Link label="Video defaults" labelIcon={<FilmSlate size={16} />} href="/profile/video-defaults" />
            <UserButton.Action label="signOut" />
          </UserButton.MenuItems>
        </UserButton>
      </Show>
    </>
  );
}

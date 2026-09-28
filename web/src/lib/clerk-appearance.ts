import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type ProviderProps = ComponentProps<typeof ClerkProvider>;

/*
 * Clerk's components styled with the Bamio design tokens. Values are CSS variables,
 * so sign-in, sign-up and the profile follow the paper / night theme automatically.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "var(--text)",
    colorPrimaryForeground: "var(--bg)",
    colorForeground: "var(--text)",
    colorMutedForeground: "var(--text-secondary)",
    colorMuted: "var(--surface-sunken)",
    colorBackground: "var(--surface-raised)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--text)",
    colorBorder: "var(--line-control)",
    colorRing: "var(--focus)",
    colorDanger: "var(--error)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",
    colorNeutral: "var(--text)",
    colorModalBackdrop: "var(--overlay)",
    fontFamily: "var(--font-sans)",
    fontFamilyButtons: "var(--font-sans)",
    borderRadius: "12px",
  },
  elements: {
    formButtonPrimary: { borderRadius: "999px", fontWeight: 600, textTransform: "none" },
    socialButtonsBlockButton: { borderRadius: "999px" },
    formFieldInput: { borderRadius: "999px" },
    otpCodeFieldInput: { borderRadius: "10px" },
    card: { boxShadow: "var(--shadow-3)" },
    userButtonAvatarBox: { width: "32px", height: "32px", borderRadius: "10px" },
    userButtonPopoverCard: { boxShadow: "var(--shadow-3)" },
  },
} satisfies NonNullable<ProviderProps["appearance"]>;

/* Plain, specific wording to match the Bamio voice. */
export const clerkLocalization = {
  userButton: {
    action__manageAccount: "Edit profile",
    action__signOut: "Sign out",
  },
  signIn: { start: { subtitle: "Sign in to continue." } },
  signUp: { start: { subtitle: "Create your account to start clipping." } },
} satisfies NonNullable<ProviderProps["localization"]>;

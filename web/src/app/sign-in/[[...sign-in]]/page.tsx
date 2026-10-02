import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Sign in", robots: PRIVATE_PAGE };

export default function SignInPage() {
  return (
    <AuthShell title="Welcome back. Your videos are waiting.">
      <SignIn />
    </AuthShell>
  );
}

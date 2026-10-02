import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Sign up", robots: PRIVATE_PAGE };

export default function SignUpPage() {
  return (
    <AuthShell title="Make your first video in minutes.">
      <SignUp />
    </AuthShell>
  );
}

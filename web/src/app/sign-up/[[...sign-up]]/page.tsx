import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <AuthShell title="Make your first video in minutes.">
      <SignUp />
    </AuthShell>
  );
}

import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { clerkAppearance, clerkLocalization } from "@/lib/clerk-appearance";
import "@/styles/tokens.css";
import "@/styles/components.css";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"], // latin-ext carries the dotless ı used in the wordmark
  variable: "--font-bricolage",
  display: "swap",
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Bamio: clip the moments that hook", template: "%s | Bamio" },
  description: "Turn YouTube, Twitch and Kick videos into vertical shorts. Bamio finds the best moments, reframes them and adds word-by-word captions.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2EE" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0E0E" },
  ],
};

/* Applies the saved theme before first paint so there is no flash. */
const themeScript = `try{var t=localStorage.getItem("bamio-theme");if(t==="paper"||t==="night")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${geistMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ClerkProvider
          appearance={clerkAppearance}
          localization={clerkLocalization}
          signInFallbackRedirectUrl="/projects"
          signUpFallbackRedirectUrl="/projects"
          afterSignOutUrl="/"
        >
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <ToastProvider>{children}</ToastProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
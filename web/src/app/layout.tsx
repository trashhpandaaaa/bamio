import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { ADSENSE_SCRIPT, adsEnabled } from "@/lib/ads";
import { clerkAppearance, clerkLocalization } from "@/lib/clerk-appearance";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME, SITE_URL } from "@/lib/site";
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
  // Only timecodes use it: not worth competing with the hero image for the first second.
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: "%s | Bamio" },
  description: HOME_DESCRIPTION,
  applicationName: SITE_NAME,
  // Defaults for pages without their own (public pages set the whole set with pageMetadata, canonical included).
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", title: HOME_TITLE, description: HOME_DESCRIPTION },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  // Search Console and Bing Webmaster Tools ownership checks, when verified by meta tag (DNS works too).
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
  formatDetection: { telephone: false, email: false, address: false },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2EE" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0E0E" },
  ],
};

/**
 * Clerk’s frontend API, from the publishable key ("pk_live_" + base64 of "clerk.example.com$"): its
 * scripts load on every page, so the connection opens while the page is still arriving.
 */
function clerkOrigin(): string | null {
  const encoded = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.split("_")[2] ?? "";
  const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : null;
}

/* Applies the saved theme before first paint so there is no flash. */
const themeScript = `try{var t=localStorage.getItem("bamio-theme");if(t==="paper"||t==="night")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const clerk = clerkOrigin();
  return (
    <html lang="en" className={`${bricolage.variable} ${geistMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Scripts (CORS) and the session calls (with cookies) use separate connections. */}
        {clerk ? <link rel="preconnect" href={clerk} crossOrigin="anonymous" /> : null}
        {clerk ? <link rel="preconnect" href={clerk} /> : null}
        {/* Google AdSense, as Google gives it: in the head of every page, where its crawler looks. Async, so it never holds the page up. */}
        {adsEnabled() ? <script async src={ADSENSE_SCRIPT} crossOrigin="anonymous" /> : null}
      </head>
      <body>
        <ClerkProvider
          appearance={clerkAppearance}
          localization={clerkLocalization}
          // Bamio's own pages (not left to NEXT_PUBLIC_ settings, which a Docker build doesn't see).
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
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
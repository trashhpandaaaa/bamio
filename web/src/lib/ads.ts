/*
 * Ads (Google AdSense). The script is in the head of every page (app/layout.tsx), which is
 * where AdSense looks for it to verify the site and where its Auto ads start from; which pages
 * show ads, and how many, is set in the AdSense account, not here. public/ads.txt names the
 * same publisher (a test checks they agree). The privacy page says ads are shown and what
 * Google's cookies do: keep it true if this changes.
 */

/** Bamio's AdSense publisher id, as the script's `client`. */
export const ADSENSE_CLIENT = "ca-pub-2429736538102794";

export const ADSENSE_SCRIPT = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/**
 * Off on test servers and CI (BAMIO_ADS=off, at build and at start: static pages keep what the
 * build saw), so the test suite never calls Google and never counts as a visit.
 */
export const adsEnabled = () => process.env.BAMIO_ADS !== "off";

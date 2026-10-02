#!/usr/bin/env node
/*
 * Checks the email setup: sends one short email through Resend with RESEND_API_KEY and
 * EMAIL_FROM from web/.env (nothing is printed from it but the sender).
 *   npm run email:check -- you@example.com
 * Resend's test inboxes work too: delivered@resend.dev (accepted), bounced@resend.dev (bounces).
 */
import nextEnv from "@next/env";
import { Resend } from "resend";

nextEnv.loadEnvConfig(process.cwd(), true);

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+$/.test(to)) fail("Usage: npm run email:check -- you@example.com");
const key = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
if (!key) fail("RESEND_API_KEY isn’t set in web/.env. Make a key at https://resend.com/api-keys (Sending access is enough).");
if (!from) fail("EMAIL_FROM isn’t set in web/.env, for example: Bamio <hello@your-domain.com>, on a domain verified in Resend.");
if (process.env.BAMIO_EMAIL === "off" || process.env.BAMIO_EMAIL === "preview") console.warn(`! BAMIO_EMAIL=${process.env.BAMIO_EMAIL}: the app won’t send emails until you remove it.`);
if (!process.env.BAMIO_APP_URL) console.warn("! BAMIO_APP_URL isn’t set: links in emails go to http://localhost:3000 in development, and production sends no emails without it.");

const { data, error } = await new Resend(key).emails.send({
  from,
  to,
  subject: "Bamio can send emails",
  text: "This is a test from npm run email:check. Bamio’s emails (plans, videos ready, AI minutes) will come from this address.",
  html: "<p>This is a test from <code>npm run email:check</code>. Bamio’s emails (plans, videos ready, AI minutes) will come from this address.</p>",
});
if (error) {
  const hint =
    error.name === "invalid_api_key" || error.name === "restricted_api_key"
      ? " Check RESEND_API_KEY."
      : error.name === "invalid_from_address" || /domain/i.test(error.message)
        ? " EMAIL_FROM must be on a domain you verified at https://resend.com/domains."
        : /own email address|testing emails/i.test(error.message)
          ? " Until you verify a domain, Resend only sends to your own account’s address."
          : "";
  fail(`Resend refused it (${error.name}${error.statusCode ? `, ${error.statusCode}` : ""}): ${error.message}${hint}`);
}
console.log(`✓ Sent from ${from} to ${to} (Resend id ${data.id}).`);

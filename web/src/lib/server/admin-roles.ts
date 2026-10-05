import "server-only";

/* Who the superadmins are, apart from the admin panel's page helpers (admin.ts), so workers can read it too. */

const emailList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** The superadmins' email addresses (BAMIO_SUPERADMINS). */
export const superadminEmails = () => emailList(process.env.BAMIO_SUPERADMINS);

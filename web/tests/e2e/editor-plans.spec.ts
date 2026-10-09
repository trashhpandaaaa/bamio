import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { signIn } from "./auth";

/*
 * The editor with plans switched on: the basics for an account without one, 1080p from Starter,
 * silence removal, 60 frames a second and ducking music from Pro (lib/editor/features.ts).
 * Opt-in, like billing.spec.ts, against a server started with a fake Stripe key, and without
 * BAMIO_SUPERADMINS naming the e2e user (an admin has everything):
 *   STRIPE_SECRET_KEY=sk_test_e2e_fake BAMIO_AI_MOCK=1 npx next start -p 3100
 *   E2E_BILLING=1 npx playwright test editor-plans
 */
test.skip(!process.env.E2E_BILLING, "Set E2E_BILLING=1, with the test server started with STRIPE_SECRET_KEY set.");

const sql = postgres(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/bamio", { onnotice: () => undefined, max: 2 });
test.afterAll(() => sql.end());
const userId = (page: Page) => page.evaluate(() => (window as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id);

async function clearPlan(id: string) {
  await sql`delete from trial_cards where user_id = ${id}`;
  await sql`delete from plan_grants where user_id = ${id}`;
  await sql`delete from billing_accounts where user_id = ${id}`;
}

/** A plan, the way checkout and Stripe's webhooks would have saved it (read just now, so the server doesn't ask Stripe). */
async function setPlan(id: string, plan: "starter" | "pro" | null) {
  const now = Date.now();
  await clearPlan(id);
  if (!plan) return;
  const subscription = { id: "sub_e2e", status: "active", plan, interval: "month", anchor: now - 86400_000, periodEnd: now + 29 * 86400_000, cancelAt: null, checkedAt: now };
  await sql`insert into billing_accounts (user_id, data, updated_at) values (${id}, ${sql.json({ customerId: "cus_e2e", subscription })}, ${now})`;
}

/** A tone to stand in for music: a sound needs no video codec, so this runs in any browser. */
function tone(): string {
  const file = path.join(process.cwd(), "qa", "fixtures", "tone.wav");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=12", "-ac", "2", file], { windowsHide: true });
  }
  return file;
}

/** An empty edit with a sound in it, selected: enough to see every control that a plan decides. */
async function openEditor(page: Page) {
  await page.goto("/editor");
  await page.getByRole("button", { name: "Start empty" }).click();
  await expect(page).toHaveURL(/\/editor\?edit=/);
  await page.getByRole("tab", { name: "Sound" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add music or a sound" }).click();
  await (await chooser).setFiles(tone());
  const sound = page.getByRole("listbox", { name: "Sounds" }).getByRole("option");
  await expect(sound).toHaveCount(1, { timeout: 60_000 });
  await sound.click();
}

async function closeEditor(page: Page) {
  await page.getByRole("button", { name: "Edits" }).click();
  await page.getByRole("button", { name: "Delete Untitled edit" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
}

test.describe("the editor's plans", () => {
  let id = "";
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    id = await userId(page);
  });
  test.afterEach(async () => {
    if (id) await clearPlan(id);
  });

  test("without a plan: the basics, and each extra says which plan it comes with", async ({ page }) => {
    await setPlan(id, null);
    await openEditor(page);
    // Music can't be set to duck.
    const duck = page.getByRole("switch", { name: "Lower it while someone talks" });
    await expect(duck).toBeDisabled();
    await expect(page.getByTestId("plan-note-duck")).toContainText("Music that ducks under speech comes with Pro.");
    await expect(page.getByTestId("plan-note-duck").getByRole("link", { name: "See the plans" })).toHaveAttribute("href", "/pricing");
    // Silences are counted, not cut.
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByRole("button", { name: "Cut them out" })).toBeDisabled();
    await expect(page.getByTestId("plan-note-silence")).toContainText("Silence removal comes with Pro.");
    // The export is 720p, 30 frames a second.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByRole("button", { name: "1080p" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "720p" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText("720 x 1280, 30 frames a second, no watermark")).toBeVisible();
    await expect(dialog.getByTestId("plan-note-hd")).toContainText("1080p export comes with Starter.");
    await expect(dialog.getByRole("button", { name: "60 a second" })).toBeDisabled();
    await expect(dialog.getByTestId("plan-note-smooth")).toContainText("60 fps export comes with Pro.");
    if (process.env.E2E_SCREENSHOTS) {
      mkdirSync("qa/screens", { recursive: true });
      await page.screenshot({ path: "qa/screens/36-editor-export-free.png" });
    }
    await dialog.getByRole("button", { name: "Not now" }).click();
    // What was always free still is: text, the progress bar, the shapes.
    await page.getByRole("tab", { name: "Frame" }).click();
    await expect(page.getByRole("group", { name: "Shape" }).getByRole("button", { name: /1:1/ })).toBeEnabled();
    await closeEditor(page);
  });

  test("Starter: 1080p, and the rest still comes with Pro", async ({ page }) => {
    await setPlan(id, "starter");
    await openEditor(page);
    await expect(page.getByRole("switch", { name: "Lower it while someone talks" })).toBeDisabled();
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByTestId("plan-note-silence")).toBeVisible();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByRole("button", { name: "1080p" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText("1080 x 1920, 30 frames a second")).toBeVisible();
    await expect(dialog.getByTestId("plan-note-hd")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "60 a second" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Not now" }).click();
    await closeEditor(page);
  });

  test("Pro: everything, with nothing to upsell", async ({ page }) => {
    await setPlan(id, "pro");
    await openEditor(page);
    const duck = page.getByRole("switch", { name: "Lower it while someone talks" });
    await expect(duck).toBeEnabled();
    await duck.check();
    await expect(duck).toBeChecked();
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByTestId("plan-note-silence")).toHaveCount(0);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByRole("button", { name: "1080p" })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "60 a second" }).click();
    await expect(dialog.getByText("1080 x 1920, 60 frames a second")).toBeVisible();
    await expect(dialog.locator("[data-testid^=plan-note-]")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Not now" }).click();
    await closeEditor(page);
  });
});

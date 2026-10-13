import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { signIn } from "./auth";

/*
 * The editor with plans switched on: the basics for an account without one, then Starter's and
 * Pro's features (lib/editor/features.ts), each locked one saying which plan it comes with.
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

/** A small picture: a photo clip shows the clip tools a plan decides, in any browser (no video codec needed). */
function logo(): string {
  const file = path.join(process.cwd(), "qa", "fixtures", "logo.png");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xC8FF3D:s=240x120", "-frames:v", "1", file], { windowsHide: true });
  }
  return file;
}

/** Add a photo and select its clip. */
async function addPhoto(page: Page) {
  await page.getByRole("tab", { name: "Media" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add videos, photos or sounds" }).click();
  await (await chooser).setFiles(logo());
  const clip = page.getByRole("listbox", { name: "Clips" }).getByRole("option");
  await expect(clip).toHaveCount(1, { timeout: 30_000 });
  await clip.click();
}

/** Which features show a plan note, across the panel and the export dialog (the sound, then a photo clip, selected). */
async function lockedFeatures(page: Page): Promise<string[]> {
  const notes = new Set<string>();
  const collect = async () => {
    for (const id of await page.locator("[data-testid^=plan-note-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("plan-note-", "")))) notes.add(id);
  };
  // The sound (clicking a selected item would deselect it).
  const sound = page.getByRole("listbox", { name: "Sounds" }).getByRole("option");
  if ((await sound.getAttribute("aria-selected")) !== "true") await sound.click();
  await page.getByRole("tab", { name: "Edit" }).click();
  await collect();
  if ((await page.getByRole("listbox", { name: "Clips" }).getByRole("option").count()) === 0) await addPhoto(page);
  else await page.getByRole("listbox", { name: "Clips" }).getByRole("option").click();
  await collect();
  for (const tab of ["Text", "Tools"]) {
    await page.getByRole("tab", { name: tab }).click();
    await collect();
  }
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await collect();
  await page.getByRole("dialog", { name: "Export" }).getByRole("button", { name: "Not now" }).click();
  return [...notes].sort();
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
    // The newer features: each locked one says its plan, and the free ones are open.
    expect(await lockedFeatures(page)).toEqual(["autoCaptions", "beats", "duck", "greenScreen", "hd", "layouts", "level", "shapes", "silence", "smooth"]);
    await page.getByRole("tab", { name: "Text" }).click();
    await expect(page.getByRole("button", { name: "Make captions" })).toBeDisabled();
    // The photo clip is still selected.
    await page.getByRole("tab", { name: "Edit" }).click();
    await expect(page.getByRole("group", { name: "Layout" }).getByRole("button", { name: "Facecam on top" })).toBeDisabled();
    await expect(page.getByRole("switch", { name: "Take out the green behind" })).toBeDisabled();
    await page.getByRole("tab", { name: "Media" }).click();
    await expect(page.getByRole("button", { name: "Add logo.png as a layer" })).toBeEnabled();
    // The locks in the page can be got around; the server says no by itself.
    const status = await page.evaluate(() => fetch("/api/editor/captions?language=auto", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Uint8Array(64) }).then((r) => r.status));
    expect(status).toBe(402);
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
    expect(await lockedFeatures(page)).toEqual(["autoCaptions", "beats", "bigExport", "duck", "greenScreen", "silence", "smooth"]);
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
    expect(await lockedFeatures(page)).toEqual([]);
    await page.getByRole("tab", { name: "Text" }).click();
    await expect(page.getByRole("button", { name: "Make captions" })).toBeEnabled();
    await closeEditor(page);
  });
});

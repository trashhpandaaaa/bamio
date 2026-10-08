import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";
import { clearCampaigns, connect, DEMO, seedCampaign } from "./campaign-seed";

/*
 * A QA sweep of every screen, in the light and the dark theme: errors in the browser console,
 * page crashes, requests that failed (4xx/5xx, network errors), and accessibility problems
 * (axe-core, WCAG 2.1 A and AA). It fails on any of them. Report in qa/sweep/ (gitignored).
 * Opt-in, against a server whose BAMIO_SUPERADMINS names the e2e user (for the admin pages):
 *   E2E_SWEEP=1 npx playwright test sweep
 */
test.skip(!process.env.E2E_SWEEP, "Set E2E_SWEEP=1 to sweep every screen for errors and accessibility problems.");

const sql = connect();
test.afterAll(() => sql.end());

const OUT = "qa/sweep";
const AXE = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");
const THEMES = ["paper", "night"] as const;

type Screen = { name: string; path: string; ready: (p: Page) => Promise<unknown>; status?: number };
type Finding = { screen: string; theme: string; kind: "console" | "crash" | "request" | "a11y"; detail: string };

/** Problems that aren't Bamio's: Clerk's development-instance notices, the browser's own warnings about third parties. */
const IGNORED = [/Clerk has been loaded with development keys/i, /clerk\.browser\.js/i, /Download the React DevTools/i];

async function sweep(page: Page, screens: Screen[], findings: Finding[]) {
  let current = { screen: "", theme: "" };
  let expectedStatus: number | undefined;
  const expected = () => expectedStatus;
  const note = (kind: Finding["kind"], detail: string) => {
    if (IGNORED.some((r) => r.test(detail))) return;
    findings.push({ ...current, kind, detail: detail.slice(0, 1200) });
  };
  page.on("console", (m) => {
    // The browser logs a page that is meant to be a 404 as a failed load.
    if (m.type() === "error" && !(expected() === 404 && /status of 404/.test(m.text()))) note("console", m.text());
  });
  page.on("pageerror", (e) => note("crash", `${e.name}: ${e.message}`));
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    // Navigating away aborts what was still loading (video ranges, prefetches): not a failure.
    if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(why)) note("request", `${r.method()} ${r.url()} ${why}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !(r.request().isNavigationRequest() && r.status() === expected())) note("request", `${r.status()} ${r.request().method()} ${r.url()}`);
  });

  for (const theme of THEMES) {
    await page.evaluate((t) => localStorage.setItem("bamio-theme", t), theme);
    for (const s of screens) {
      current = { screen: s.name, theme };
      expectedStatus = s.status;
      await page.goto(s.path);
      await s.ready(page);
      // Down the page and back, so what animates in when seen has (the demos), then checked as people see it.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 1500));
        // A demo still fading a clip in would be measured half transparent: let transitions end (loops never do, so not those).
        const fades = document.getAnimations().filter((a) => a instanceof CSSTransition);
        await Promise.race([Promise.allSettled(fades.map((a) => a.finished)), new Promise((r) => setTimeout(r, 5000))]);
      });
      await page.addScriptTag({ path: AXE });
      const violations = await page.evaluate(async () => {
        type Node = { target: string[]; any: { data?: { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string } }[] };
        const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: Node[] }[] }> } }).axe;
        const where = (n: Node) => {
          const d = n.any[0]?.data;
          return n.target.join(" ") + (d?.contrastRatio ? ` [${d.fgColor} on ${d.bgColor}: ${d.contrastRatio}, needs ${d.expectedContrastRatio}]` : "");
        };
        // Clerk's own forms; and the editor's "Pop" caption sample, whose black outline axe measures
        // against the dark tile while what people see is the volt fill (about 15:1).
        const res = await axe.run({ exclude: [[".cl-rootBox"], [".cl-internal-b3fm6y"], ['button[data-style="pop"] [aria-hidden="true"]']] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
        return res.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x: ${v.nodes.slice(0, 8).map(where).join(" | ")})`);
      });
      for (const v of violations) note("a11y", v);
      await page.screenshot({ path: `${OUT}/${s.name}-${theme}.png`, fullPage: true });
    }
  }
}

function report(part: string, findings: Finding[]) {
  writeFileSync(`${OUT}/report-${part}.json`, JSON.stringify(findings, null, 2));
  const unique = [...new Set(findings.map((f) => `[${f.kind}] ${f.screen}: ${f.detail}`))];
  expect(unique, `QA sweep (${part}) found problems`).toEqual([]);
}

const heading = (p: Page) => expect(p.getByRole("heading", { level: 1 }).first()).toBeVisible();

test("public pages", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const findings: Finding[] = [];
  // A campaign for its public page (not when sweeping another server: this database isn't its).
  const local = !process.env.E2E_BASE_URL;
  if (local) await seedCampaign(sql);
  await page.goto("/");
  await sweep(
    page,
    [
      { name: "landing", path: "/", ready: (p) => expect(p.locator("#hero-link")).toBeVisible() },
      { name: "pricing", path: "/pricing", ready: (p) => expect(p.getByRole("article").first()).toBeVisible() },
      { name: "youtube-to-shorts", path: "/youtube-to-shorts", ready: heading },
      { name: "podcast-clips", path: "/podcast-clips", ready: heading },
      { name: "twitch-clips", path: "/twitch-clips", ready: heading },
      { name: "auto-captions", path: "/auto-captions", ready: heading },
      { name: "video-editor-page", path: "/video-editor", ready: heading },
      { name: "ai-video-clipper", path: "/ai-video-clipper", ready: heading },
      { name: "youtube-to-tiktok", path: "/youtube-to-tiktok", ready: heading },
      { name: "video-to-reels", path: "/video-to-reels", ready: heading },
      { name: "kick-clips", path: "/kick-clips", ready: heading },
      { name: "gaming-clips", path: "/gaming-clips", ready: heading },
      { name: "captions-hindi", path: "/auto-captions/hindi", ready: heading },
      { name: "captions-arabic", path: "/auto-captions/arabic", ready: heading },
      { name: "captions-japanese", path: "/auto-captions/japanese", ready: heading },
      { name: "sign-in", path: "/sign-in", ready: (p) => expect(p.locator(".cl-rootBox, .cl-signIn-root").first()).toBeVisible() },
      { name: "sign-up", path: "/sign-up", ready: (p) => expect(p.locator(".cl-rootBox, .cl-signUp-root").first()).toBeVisible() },
      { name: "campaigns", path: "/clippers", ready: heading },
      ...(local ? [{ name: "campaign", path: `/clippers/${DEMO.slug}`, ready: (p: Page) => expect(p.getByRole("link", { name: "Sign in to join" })).toBeVisible() }] : []),
      { name: "terms", path: "/terms", ready: heading },
      { name: "privacy", path: "/privacy", ready: heading },
      { name: "takedown", path: "/takedown", ready: heading },
      { name: "not-found", path: "/no-such-page", ready: heading, status: 404 },
    ],
    findings,
  );
  if (local) await clearCampaigns(sql);
  report("public", findings);
});

test("signed-in pages, a project and the editor", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const findings: Finding[] = [];
  await signIn(page);
  const me = await page.evaluate(() => (window as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id);

  await page.goto("/new");
  await page.getByRole("button", { name: "Upload a file" }).click();
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
  await page.getByRole("button", { name: "Import and find clips" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  const projectPath = new URL(page.url()).pathname;
  // A campaign with the e2e user in it, for the clipper's panel and the admin's pages.
  const { requestId } = await seedCampaign(sql, { joined: me });
  try {
    await expect(page.getByTestId("clip-card").first()).toBeVisible({ timeout: 180_000 });
    const editPath = await page.getByTestId("clip-card").first().getByRole("link", { name: "Edit" }).getAttribute("href");
    // An edit in the video editor too, with the sample in it where this browser can decode it (H.264). It lives in this test's browser only.
    await page.goto("/editor");
    const decodes = await page.evaluate(async () => typeof VideoDecoder !== "undefined" && (await VideoDecoder.isConfigSupported({ codec: "avc1.640028" }).then((s) => s.supported === true, () => false)));
    if (decodes) {
      await page.getByTestId("editor-new-files").setInputFiles(SAMPLE_VIDEO);
      await expect(page.getByRole("listbox", { name: "Clips" }).getByRole("option")).toHaveCount(1, { timeout: 90_000 });
      await page.getByRole("tab", { name: "Text" }).click();
      await page.getByRole("button", { name: "Add text" }).click();
    } else await page.getByRole("button", { name: "Start empty" }).click();
    await page.waitForURL(/\/editor\?edit=/);
    await expect(page.getByText("Saved on this device")).toBeVisible({ timeout: 30_000 });
    const editorPath = new URL(page.url()).pathname + new URL(page.url()).search;
    await sweep(
      page,
      [
        { name: "projects", path: "/projects", ready: heading },
        { name: "import", path: "/new", ready: (p) => expect(p.getByLabel("Video link")).toBeVisible() },
        { name: "import-upload", path: "/new?mode=upload", ready: (p) => expect(p.getByText(/Drop a video here|Choose a file/i).first()).toBeVisible() },
        { name: "project", path: projectPath, ready: (p) => expect(p.getByTestId("clip-card").first()).toBeVisible() },
        { name: "editor", path: editPath!, ready: (p) => expect(p.getByRole("button", { name: "Export", exact: true })).toBeVisible() },
        { name: "billing", path: "/billing", ready: (p) => expect(p.getByRole("heading", { level: 2 }).first()).toBeVisible() },
        { name: "edits", path: "/editor", ready: (p) => expect(p.getByRole("heading", { name: "Your edits on this device" })).toBeVisible() },
        ...(editorPath ? [{ name: "video-editor", path: editorPath, ready: (p: Page) => expect(p.getByRole("button", { name: "Export", exact: true })).toBeVisible() }] : []),
        { name: "profile", path: "/profile", ready: (p) => expect(p.locator(".cl-userProfile-root, .cl-rootBox").first()).toBeVisible() },
        { name: "clip-defaults", path: "/profile/clip-defaults", ready: (p) => expect(p.getByRole("heading", { name: "Clip defaults" })).toBeVisible() },
        { name: "notifications", path: "/profile/notifications", ready: (p) => expect(p.getByRole("heading", { name: "Notifications" })).toBeVisible() },
        { name: "delete-account", path: "/profile/delete-account", ready: (p) => expect(p.getByRole("heading", { name: "Delete account" })).toBeVisible() },
        { name: "profile-clipper", path: "/profile/clipper", ready: (p) => expect(p.getByRole("heading", { name: "Clipper details" })).toBeVisible() },
        { name: "campaigns-mine", path: "/clippers", ready: (p) => expect(p.getByRole("heading", { name: "Your campaigns" })).toBeVisible() },
        { name: "campaign-joined", path: `/clippers/${DEMO.slug}`, ready: (p) => expect(p.getByRole("heading", { name: "Your clips" })).toBeVisible() },
        { name: "campaigns-run", path: "/clippers?run=1", ready: (p) => expect(p.getByRole("heading", { name: "Your campaign", exact: true })).toBeVisible() },
        { name: "admin", path: "/admin", ready: heading },
        { name: "admin-users", path: "/admin/users", ready: heading },
        { name: "admin-campaigns", path: "/admin/campaigns", ready: heading },
        { name: "admin-campaign", path: `/admin/campaigns/${DEMO.id}`, ready: heading },
        { name: "admin-campaign-new", path: "/admin/campaigns/new", ready: heading },
        { name: "admin-campaign-from-request", path: `/admin/campaigns/new?request=${requestId}`, ready: (p) => expect(p.getByText("From E2E Test Show’s request")).toBeVisible() },
        { name: "admin-campaign-edit", path: `/admin/campaigns/${DEMO.id}/edit`, ready: heading },
        { name: "admin-user", path: `/admin/users/${me}`, ready: heading },
        { name: "admin-jobs", path: "/admin/jobs?view=recent", ready: heading },
        { name: "admin-money", path: "/admin/money", ready: heading },
        { name: "admin-admins", path: "/admin/admins", ready: heading },
      ],
      findings,
    );
  } finally {
    await clearCampaigns(sql, me);
    expect((await page.request.delete(projectPath.replace("/projects/", "/api/projects/"))).status()).toBe(204);
  }
  report("app", findings);
});

import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";

/*
 * Responsive QA of every screen, at phone, tablet and desktop widths: no sideways scroll, nothing
 * spilling off screen, tap targets of 24px or more. The pages first; then it uploads the sample
 * video to have a project, a clip and the editor to look at, and deletes it afterwards.
 * Screenshots and reports land in qa/responsive/ (gitignored). Opt-in:
 *   E2E_RESPONSIVE=1 npx playwright test responsive
 */
test.skip(!process.env.E2E_RESPONSIVE, "Set E2E_RESPONSIVE=1 to check every screen at several widths.");

const WIDTHS = [320, 390, 768, 1024, 1440];
const OUT = "qa/responsive";

type Metrics = { overflow: number; spills: string[]; small: string[] };

/** What doesn't fit: sideways scroll, elements past the screen's edges (not inside a clipping box), small tap targets. */
function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const name = (el: Element) => {
      const c = typeof el.className === "string" ? el.className.split(" ").map((x) => x.replace(/^[\w-]+?-module__\w+__/, "")).join(".") : "";
      return `${el.tagName.toLowerCase()}${c ? "." + c : ""}`;
    };
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (/hidden|clip|auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
      return false;
    };
    const shown = (el: Element) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 && b.width > 0 && b.height > 0;
    };
    const spills = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && (b.right > vw + 0.5 || b.left < -0.5) && !clipped(el) && !el.closest("[data-sonner-toaster], .cl-internal-b3fm6y");
      })
      .map((el) => `${name(el)} [${Math.round(el.getBoundingClientRect().left)}, ${Math.round(el.getBoundingClientRect().right)}]`)
      .slice(0, 10);
    const small = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, summary, [role=button], [role=slider]")]
      // Not tap targets: visually hidden inputs (their label or drop zone is), and Clerk's own logo link.
      .filter((el) => shown(el) && !el.closest("[inert]") && !el.classList.contains("sr-only") && el.getAttribute("aria-label") !== "Clerk logo")
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width < 24 || b.height < 24;
      })
      .map((el) => `${name(el)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`)
      .slice(0, 12);
    return { overflow: document.documentElement.scrollWidth - vw, spills, small };
  });
}

type Screen = { name: string; path: string; ready: (p: Page) => Promise<void> };

/** Every screen at every width; the report lands in qa/responsive/report-<part>.json. */
async function audit(page: Page, part: string, screens: Screen[]) {
  const report: Record<string, Metrics> = {};
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const s of screens) {
        await page.goto(s.path);
        await s.ready(page);
        await page.waitForTimeout(600);
        const m = await measure(page);
        report[`${s.name}@${width}`] = m;
        await page.screenshot({ path: `${OUT}/${s.name}-${width}.png`, fullPage: true });
        expect.soft(m.overflow, `${s.name} at ${width}px scrolls sideways: ${m.spills.join(", ")}`).toBe(0);
        expect.soft(m.spills, `${s.name} at ${width}px: elements past the edge`).toEqual([]);
        expect.soft(m.small, `${s.name} at ${width}px: tap targets under 24px`).toEqual([]);
      }
    }
  } finally {
    writeFileSync(`${OUT}/report-${part}.json`, JSON.stringify(report, null, 2));
  }
}

test("pages fit phones, tablets and desktops", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(OUT, { recursive: true });
  await signIn(page);
  await audit(page, "pages", [
    { name: "landing", path: "/", ready: (p) => expect(p.locator("#hero-link")).toBeVisible() },
    { name: "pricing", path: "/pricing", ready: (p) => expect(p.getByRole("article").first()).toBeVisible() },
    { name: "import", path: "/new", ready: (p) => expect(p.getByLabel("Video link")).toBeVisible() },
    { name: "import-upload", path: "/new?mode=upload", ready: (p) => expect(p.getByText(/Drop a video here|Choose a file/i).first()).toBeVisible() },
    { name: "projects", path: "/projects", ready: (p) => expect(p.getByRole("heading", { level: 1 })).toBeVisible() },
    { name: "billing", path: "/billing", ready: (p) => expect(p.getByRole("heading", { level: 2 }).first()).toBeVisible() },
    { name: "clip-defaults", path: "/profile/clip-defaults", ready: (p) => expect(p.getByRole("heading", { name: "Clip defaults" })).toBeVisible() },
    { name: "notifications", path: "/profile/notifications", ready: (p) => expect(p.getByRole("heading", { name: "Notifications" })).toBeVisible() },
  ]);
});

test("a project and the editor fit phones, tablets and desktops", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(OUT, { recursive: true });
  await signIn(page);

  // A project with clips, from the sample video (mock AI finds the clips).
  await page.goto("/new");
  await page.getByRole("button", { name: "Upload a file" }).click();
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
  await page.getByRole("button", { name: "Import and find clips" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  const projectPath = new URL(page.url()).pathname;
  try {
    await expect(page.getByTestId("clip-card").first()).toBeVisible({ timeout: 180_000 });
    const editPath = await page.getByTestId("clip-card").first().getByRole("link", { name: "Edit" }).getAttribute("href");
    expect(editPath).toBeTruthy();
    await audit(page, "project", [
      { name: "project", path: projectPath, ready: (p) => expect(p.getByTestId("clip-card").first()).toBeVisible() },
      { name: "editor", path: editPath!, ready: (p) => expect(p.getByRole("button", { name: "Export", exact: true })).toBeVisible() },
    ]);
  } finally {
    expect((await page.request.delete(projectPath.replace("/projects/", "/api/projects/"))).status()).toBe(204);
  }
});

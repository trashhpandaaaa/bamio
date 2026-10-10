import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/*
 * Where the time goes: imports 20 minutes of a real YouTube podcast (mock AI; speech is
 * transcribed for real), timing every step, opening the pages, and one export. Opt-in:
 *   E2E_PERF=1 npx playwright test perf          (E2E_PERF_URL to use another video)
 */

test("time an import, the pages and an export", async ({ page }) => {
  test.skip(!process.env.E2E_PERF, "Set E2E_PERF=1 to time an import (needs internet).");
  test.setTimeout(60 * 60_000);
  const url = process.env.E2E_PERF_URL ?? "https://www.youtube.com/watch?v=FaGp61HQnBw";
  const times: string[] = [];
  const clock = Date.now();
  const mark = (label: string, since: number) => times.push(`${label.padEnd(28)} ${((Date.now() - since) / 1000).toFixed(1)} s`);

  await signIn(page);
  let t = Date.now();
  await page.goto("/new");
  await expect(page.getByLabel("Video link")).toBeVisible();
  mark("open /new", t);

  t = Date.now();
  await page.getByLabel("Video link").fill(url);
  const part = page.getByRole("switch", { name: "Import only part of the video" });
  await expect(part).toBeVisible({ timeout: 90_000 });
  mark("look up the link", t);
  await part.check();
  await page.getByRole("textbox", { name: "From", exact: true }).fill("15:00");
  await page.getByRole("textbox", { name: "To", exact: true }).fill("35:00");
  await page.getByRole("button", { name: /^Import/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  const api = new URL(page.url()).pathname.replace("/projects/", "/api/projects/");

  // Each step, from the job's status as the page sees it.
  const started = Date.now();
  let status = "";
  let since = Date.now();
  for (;;) {
    const p = (await (await page.request.get(api)).json()) as { job: { status: string } };
    if (p.job.status !== status) {
      if (status) mark(`  ${status}`, since);
      status = p.job.status;
      since = Date.now();
    }
    if (status === "ready" || status === "failed") break;
    await page.waitForTimeout(500);
  }
  expect(status).toBe("ready");
  mark("import in all", started);

  t = Date.now();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Clips/ })).toBeVisible();
  mark("open the project", t);

  t = Date.now();
  await page.getByTestId("clip-card").first().getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/clips\/[0-9a-f-]{36}$/);
  await expect.poll(() => page.locator("video").first().evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThan(1);
  mark("open the editor (video ready)", t);

  t = Date.now();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("main").getByRole("link", { name: /^Download/ })).toBeVisible({ timeout: 600_000 });
  mark("export one clip", t);

  expect((await page.request.delete(api)).status()).toBe(204);
  mark("whole test", clock);
  console.log(`\n${times.join("\n")}\n`);
});

import { expect, test, type Page } from "@playwright/test";

/*
 * End-to-end tests. The dev server runs with BAMIO_AI_MOCK=1, so AI answers are
 * deterministic and every route, screen and the real export pipeline are exercised.
 */

const IDEA = "Crispy chili oil eggs in 5 minutes, for people who skip breakfast";

/** Fail the test on any console error or uncaught exception (dev HMR socket noise excluded). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/webpack-hmr|_next\/hmr|WebSocket/.test(msg.text())) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function createProject(page: Page, opts: { hookIndex?: number } = {}) {
  await page.goto("/new");
  await page.getByRole("button", { name: "Recipe" }).click();
  await page.getByLabel("Describe your video").fill(IDEA);
  await page.getByRole("button", { name: "15 sec" }).click();
  await page.getByRole("button", { name: "Find the hook" }).click();
  await expect(page.getByRole("heading", { name: "Pick a hook" })).toBeVisible();
  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(4);
  await radios.nth(opts.hookIndex ?? 0).check();
  await page.getByRole("button", { name: "Write the script" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  await expect(page.getByRole("listitem", { name: /^Scene \d+$/ })).toHaveCount(4);
}

test("landing page renders and the demo video paints", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("make the first second count.");
  const canvas = page.getByRole("img", { name: /sample Bamio video/ });
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(270, 480, 1, 1).data[3]))
    .toBe(255);
  await page.getByRole("button", { name: "Pause the sample video" }).click();
  await expect(page.getByRole("button", { name: "Play the sample video" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("idea to exported video, end to end", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);

  // Brief validation
  await page.goto("/new");
  await page.getByRole("button", { name: "Find the hook" }).click();
  await expect(page.getByText("Tell Bamio a little more about the video.")).toBeVisible();
  await page.getByLabel("Describe your video").fill("x");
  await expect(page.getByText("Tell Bamio a little more about the video.")).toBeHidden();

  await createProject(page, { hookIndex: 1 });
  await expect(page.getByRole("tab", { name: "Storyboard" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Hook")).toHaveValue(/.+/);

  // Pictures and voice-over
  await page.getByRole("button", { name: "Make 3 pictures" }).click();
  await expect(page.getByRole("button", { name: "All pictures made" })).toBeVisible();
  await expect(page.locator("li img")).toHaveCount(3);
  await page.getByRole("button", { name: /Record voice-over \(4\)/ }).click();
  await expect(page.getByRole("button", { name: "Voice-over up to date" })).toBeVisible();
  await expect(page.getByText("Voice ready")).toHaveCount(4);

  // Editing a scene marks its voice-over stale
  const firstVo = page.getByLabel("Voice-over").first();
  await firstVo.fill("A brand new line for the opening.");
  await expect(page.getByText("Voice out of date")).toHaveCount(1);
  await page.getByRole("button", { name: /Record voice-over \(1\)/ }).click();
  await expect(page.getByText("Voice ready")).toHaveCount(4);

  // Edit: playback advances in real time and pauses
  await page.getByRole("tab", { name: "Edit" }).click();
  await expect(page).toHaveURL(/tab=edit/);
  const slider = page.getByRole("slider", { name: "Playhead position" });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(300);
  const t0 = Number(await slider.getAttribute("aria-valuenow"));
  await page.waitForTimeout(1000);
  const t1 = Number(await slider.getAttribute("aria-valuenow"));
  expect(t1 - t0).toBeGreaterThan(0.75);
  expect(t1 - t0).toBeLessThan(1.35);
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = Number(await slider.getAttribute("aria-valuenow"));
  await page.waitForTimeout(500);
  expect(Number(await slider.getAttribute("aria-valuenow"))).toBe(paused);
  await slider.focus();
  await page.keyboard.press("End");
  const total = Number(await slider.getAttribute("aria-valuemax"));
  await expect(slider).toHaveAttribute("aria-valuenow", String(total));
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");

  // Caption style change reaches the inspector state
  await page.getByRole("button", { name: "Boxed" }).click();
  await expect(page.getByRole("button", { name: "Boxed" })).toHaveAttribute("aria-pressed", "true");

  // Director: apply and dismiss
  await page.getByRole("tab", { name: "Director" }).click();
  await page.getByRole("button", { name: "Get notes" }).click();
  const notes = page.getByRole("list", { name: "Director notes" }).getByRole("listitem");
  await expect(notes).toHaveCount(3);
  await page.getByRole("button", { name: "Apply", exact: true }).first().click();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).last().click();
  await expect(notes).toHaveCount(2);
  await page.getByRole("tab", { name: "Storyboard" }).click();
  await expect(page.getByLabel("On-screen caption").first()).toHaveValue("you're doing this wrong");

  // Export: a real, playable 1080x1920 video file
  await page.getByRole("tab", { name: "Export" }).click();
  await page.getByRole("button", { name: "Export video" }).click();
  await expect(page.getByRole("progressbar", { name: "Export progress" })).toBeVisible();
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /^blob:/, { timeout: 90_000 });
  const info = await video.evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 1) await new Promise((r) => (v.onloadedmetadata = r));
    const blob = await fetch(v.src).then((r) => r.blob());
    return { type: blob.type, size: blob.size, width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  });
  expect(info.type).toMatch(/^video\/(mp4|webm)$/);
  expect(info.size).toBeGreaterThan(50_000);
  expect([info.width, info.height]).toEqual([1080, 1920]);
  if (Number.isFinite(info.duration)) expect(Math.abs(info.duration - total)).toBeLessThan(1.5);
  await expect(page.getByRole("link", { name: /Download (MP4|WEBM)/ })).toHaveAttribute("download", /\.(mp4|webm)$/);

  expect(errors).toEqual([]);
});

test("edits autosave and survive a reload", async ({ page }) => {
  const errors = watchErrors(page);
  await createProject(page);
  const title = page.getByLabel("Video title");
  await title.fill("Saturday eggs");
  await page.getByLabel("On-screen caption").nth(1).fill("the crispy edge is the point");
  await page.waitForTimeout(900); // past the 400 ms autosave debounce
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Video title")).toHaveValue("Saturday eggs");
  await expect(page.getByLabel("On-screen caption").nth(1)).toHaveValue("the crispy edge is the point");

  // Scene operations
  await page.getByRole("button", { name: "Add a scene" }).click();
  await expect(page.getByRole("listitem", { name: /^Scene \d+$/ })).toHaveCount(5);
  await page.getByRole("button", { name: "Delete scene 5" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete scene" }).click();
  await expect(page.getByRole("listitem", { name: /^Scene \d+$/ })).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("dashboard lists, duplicates and deletes videos", async ({ page }) => {
  const errors = watchErrors(page);
  await createProject(page);
  await page.getByLabel("Video title").fill("Dashboard test");
  await page.waitForTimeout(900);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.goto("/projects");
  const cards = page.getByRole("list", { name: "Videos" }).getByRole("listitem");
  // Each test gets a fresh browser profile, so exactly this one video exists (wait for it to load).
  await expect(cards).toHaveCount(1);
  const before = 1;
  await page.getByRole("button", { name: "Duplicate Dashboard test" }).click();
  await expect(cards).toHaveCount(before + 1);
  await expect(page.getByText("Dashboard test (copy)")).toBeVisible();
  await page.getByRole("button", { name: "Delete Dashboard test (copy)" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(cards).toHaveCount(before + 1);
  await page.getByRole("button", { name: "Delete Dashboard test (copy)" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete video" }).click();
  await expect(cards).toHaveCount(before);
  expect(errors).toEqual([]);
});

test("a video can be written without AI", async ({ page }) => {
  await page.goto("/new");
  await page.getByLabel("Describe your video").fill("A day running a one-person pottery studio");
  await page.getByRole("button", { name: "Write it myself" }).click();
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByRole("listitem", { name: /^Scene \d+$/ })).toHaveCount(3);
});

test("AI errors are shown with a way forward", async ({ page }) => {
  await page.route("**/api/ai/hooks", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "rate_limited", message: "Gemini is rate limiting this key. Wait a minute, then try again." } }),
    }),
  );
  await page.goto("/new");
  await page.getByLabel("Describe your video").fill(IDEA);
  await page.getByRole("button", { name: "Find the hook" }).click();
  // Next.js also renders a route announcer with role="alert"; target the error notice.
  await expect(page.getByRole("alert").filter({ hasText: "rate limiting" })).toContainText("Wait a minute, then try again.");
  await expect(page.getByRole("button", { name: "Find the hook" })).toBeEnabled();
});

test("workspace tabs work from the keyboard and a missing project is handled", async ({ page }) => {
  await createProject(page);
  await page.getByRole("tab", { name: "Storyboard" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Edit" })).toBeFocused();
  await expect(page).toHaveURL(/tab=edit/);
  await page.goto("/projects/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "We can’t find this video" })).toBeVisible();
});

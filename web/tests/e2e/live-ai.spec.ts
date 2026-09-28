import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/*
 * On-device transcription plus real Gemini clip finding. Needs a server started WITHOUT
 * BAMIO_AI_MOCK and a GEMINI_API_KEY, for example:
 *   npx next start -p 3200          (in one terminal)
 *   E2E_LIVE_AI=1 E2E_PORT=3200 npx playwright test live-ai
 * The fixture is a 58 s spoken track (Windows speech) over a test pattern, at
 * qa/fixtures/speech-talk.mp4.
 */
test.skip(!process.env.E2E_LIVE_AI, "Set E2E_LIVE_AI=1 (and E2E_PORT to a server with real AI) to run.");

test("transcribes speech and finds clips with real AI", async ({ page }) => {
  test.setTimeout(420_000);
  await signIn(page);
  await page.goto("/new");
  await page.getByRole("button", { name: "Upload a file" }).click();
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "qa", "fixtures", "speech-talk.mp4"));
  await page.getByRole("group", { name: "Clip length" }).getByRole("button", { name: "15 to 30s" }).click();
  await page.getByRole("button", { name: "Import and find clips" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const api = new URL(page.url()).pathname.replace("/projects/", "/api/projects/");

  const cards = page.getByTestId("clip-card");
  await expect(cards.first()).toBeVisible({ timeout: 300_000 });
  await expect(page.locator(".notice.is-warning")).toHaveCount(0);
  const titles = await cards.locator("h3").allTextContents();
  console.log("AI clips:", titles);

  await cards.first().getByRole("link", { name: "Edit" }).click();
  await page.getByText(/Fix caption words/).click();
  const words = (await page.locator("details input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join(" ");
  console.log("Captions:", words.slice(0, 300));
  expect(words.toLowerCase()).toMatch(/code|month|project|day|build|advice|secret/);
  expect((await page.request.delete(api)).status()).toBe(204);
});

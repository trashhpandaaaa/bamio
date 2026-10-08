import { expect, test } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";
import { canDecodeSample, now } from "./editor-helpers";

/*
 * The editor's voiceover: recording from the microphone while the edit plays. In a file of its
 * own because it needs a browser started with a stand-in microphone (the browser's own test
 * signal, allowed without asking), and launch options apply to a whole file.
 */
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, permissions: ["microphone"] });

test("a voiceover is recorded over the picture and laid on the timeline", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await signIn(page);
  await page.goto("/editor");
  test.skip(!(await canDecodeSample(page)), "This browser can't decode H.264 with WebCodecs.");
  await page.getByTestId("editor-new-files").setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByRole("listbox", { name: "Clips" }).getByRole("option")).toHaveCount(1, { timeout: 90_000 });
  await page.getByRole("tab", { name: "Sound" }).click();
  await page.getByRole("button", { name: "Record a voiceover" }).click();
  // The edit plays along while it records.
  await expect(page.getByRole("button", { name: /Stop recording/ })).toBeVisible();
  await expect.poll(() => now(page), { timeout: 20_000 }).toBeGreaterThan(2);
  await page.getByRole("button", { name: /Stop recording/ }).click();
  const sound = page.getByRole("listbox", { name: "Sounds" }).getByRole("option");
  await expect(sound).toHaveCount(1, { timeout: 30_000 });
  await expect(sound).toHaveAccessibleName(/^Voiceover 0-00\.wav, 0:0[1-9]/);
  // It starts where the recording started, at full volume, and is selected.
  await expect(sound).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Volume")).toHaveValue("1");
  await page.getByRole("button", { name: "Edits" }).click();
  await page.getByRole("button", { name: "Delete sample-talk" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
});

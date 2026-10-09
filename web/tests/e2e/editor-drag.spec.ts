import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";
import { canDecodeSample } from "./editor-helpers";

/*
 * Dragging in the editor: an edge of a clip, a text or a sound stretches it and its middle moves
 * it, whether or not it was selected first (grabbing the edge of something not yet selected
 * once moved it instead); and a corner of the selected text's frame in the preview resizes it.
 */

type Box = { x: number; y: number; width: number; height: number };
const boxOf = async (item: Locator) => (await item.boundingBox()) as Box;

/** Press at (x, y), drag `dx` to the right, let go. */
async function dragBy(page: Page, x: number, y: number, dx: number, dy = 0) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

test("an edge stretches, the middle moves, and a corner of the text resizes it", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await signIn(page);
  await page.goto("/editor");
  test.skip(!(await canDecodeSample(page)), "This browser can't decode H.264 with WebCodecs.");
  await page.getByTestId("editor-new-files").setInputFiles(SAMPLE_VIDEO);
  const clips = page.getByRole("listbox", { name: "Clips" }).getByRole("option");
  await expect(clips).toHaveCount(1, { timeout: 60_000 });
  const tracks = page.getByRole("group", { name: "Tracks" });
  const nothingSelected = async () => {
    await tracks.focus();
    await page.keyboard.press("Escape");
  };

  // A text at 5 s (3 s long), then nothing selected.
  await tracks.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("textbox", { name: "Text" }).fill("Stay longer");
  const text = page.getByRole("listbox", { name: "Text" }).getByRole("option");
  await nothingSelected();
  await expect(text).toHaveAttribute("aria-selected", "false");

  // Its right edge, pulled right: it lasts longer and starts where it did.
  const first = await boxOf(text);
  await dragBy(page, first.x + first.width - 3, first.y + first.height / 2, 120);
  const longer = await boxOf(text);
  expect(Math.abs(longer.x - first.x)).toBeLessThan(1.5);
  expect(longer.width).toBeGreaterThan(first.width + 100);
  await expect(text).toHaveAttribute("aria-selected", "true");

  // Its left edge, pulled left: it starts sooner and ends where it did.
  await nothingSelected();
  await dragBy(page, longer.x + 3, longer.y + longer.height / 2, -40);
  const sooner = await boxOf(text);
  expect(sooner.x).toBeLessThan(longer.x - 30);
  expect(Math.abs(sooner.x + sooner.width - (longer.x + longer.width))).toBeLessThan(1.5);

  // Its middle: the whole text moves, as long as it was.
  await nothingSelected();
  await dragBy(page, sooner.x + sooner.width / 2, sooner.y + sooner.height / 2, 50);
  const moved = await boxOf(text);
  expect(moved.x).toBeGreaterThan(sooner.x + 40);
  expect(Math.abs(moved.width - sooner.width)).toBeLessThan(1.5);

  // Longer than the slider used to go: "Shows for" follows, and doesn't cut it back.
  await expect(page.getByLabel("Shows for")).toHaveValue(/^(?:[5-9]|[1-9]\d)(?:\.\d+)?$/);

  // A clip's right edge, not selected: the clip gets shorter (it once only picked the clip up).
  await nothingSelected();
  const clip = await boxOf(clips.first());
  // A quarter of its width is a quarter of its 40 seconds (the timeline then fits itself to what's left, so the width says nothing).
  await dragBy(page, clip.x + clip.width - 3, clip.y + clip.height / 2, -clip.width / 4);
  await expect(page.getByLabel("Preview").getByText(/\/ 0:(29|30|31)\.\d/)).toBeVisible();
  await expect(clips.first()).toHaveAttribute("aria-selected", "true");

  // In the preview the selected text has a frame, and a corner of it makes the text bigger or smaller.
  await text.click();
  await tracks.focus();
  await page.keyboard.press("Home");
  const at = await boxOf(text);
  // The playhead onto the text, so it's on screen.
  await page.mouse.click(at.x + at.width / 2, (await boxOf(page.locator("[class*=ruler]"))).y + 8);
  await text.click();
  const size = page.getByLabel("Size");
  const before = Number(await size.inputValue());
  const corner = page.getByTestId("text-corner-se");
  await expect(corner).toBeVisible();
  const grip = await boxOf(corner);
  const frame = await boxOf(page.getByTestId("text-frame"));
  // Away from the middle of the text: bigger.
  await dragBy(page, grip.x + grip.width / 2, grip.y + grip.height / 2, 60, 30);
  const bigger = Number(await size.inputValue());
  expect(bigger).toBeGreaterThan(before * 1.2);
  // The frame follows the text: taller, whether the bigger letters stayed on one line or went onto two.
  await expect.poll(async () => (await boxOf(page.getByTestId("text-frame"))).height).toBeGreaterThan(frame.height * 1.2);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "qa/screens/35-editor-text-frame.png" });
  // Towards the middle again: smaller.
  const out = await boxOf(corner);
  await dragBy(page, out.x + out.width / 2, out.y + out.height / 2, -20, -10);
  const smaller = Number(await size.inputValue());
  expect(smaller).toBeLessThan(bigger);
  // The text itself still moves when it's the text that's dragged, and stays the size it was.
  const middle = await boxOf(page.getByTestId("text-frame"));
  await dragBy(page, middle.x + middle.width / 2, middle.y + middle.height / 2, 0, 60);
  await expect.poll(async () => (await boxOf(page.getByTestId("text-frame"))).y).toBeGreaterThan(middle.y + 40);
  expect(Number(await size.inputValue())).toBe(smaller);

  await page.getByRole("button", { name: "Edits" }).click();
  const saved = page.getByRole("listitem").filter({ hasText: "sample-talk" });
  await saved.getByRole("button", { name: "Delete sample-talk" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
  await expect(saved).toHaveCount(0);
});

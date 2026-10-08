import type { Page } from "@playwright/test";

/* Shared by the editor's specs. */

/** Whether this browser can decode the sample video (H.264) with WebCodecs: the open-source Chromium on CI can't. */
export const canDecodeSample = (page: Page) =>
  page.evaluate(async () => typeof VideoDecoder !== "undefined" && (await VideoDecoder.isConfigSupported({ codec: "avc1.640028" }).then((s) => s.supported === true, () => false)));

/** The clock under the preview, in seconds. */
export const now = async (page: Page) => {
  const [m, s] = ((await page.getByLabel("Preview").locator("p span").first().textContent()) ?? "0:0").split(":");
  return Number(m) * 60 + Number(s);
};

import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/*
 * Visual QA captures, not assertions. Run with:
 *   E2E_SCREENSHOTS=1 npx playwright test screens
 * Screenshots land in qa/screens/ (gitignored).
 */
test.skip(!process.env.E2E_SCREENSHOTS, "Set E2E_SCREENSHOTS=1 to capture QA screenshots.");

const shot = (name: string) => ({ path: `qa/screens/${name}.png` });

test("auth and profile screens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign up" })).toBeVisible();
  await page.screenshot(shot("01-landing-signed-out"));

  await page.goto("/sign-in");
  await expect(page.locator(".cl-signIn-root")).toBeVisible();
  await page.screenshot(shot("02-sign-in"));

  await page.goto("/sign-up");
  await expect(page.locator(".cl-signUp-root")).toBeVisible();
  await page.screenshot(shot("03-sign-up"));

  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Your projects" })).toBeVisible();
  await page.screenshot(shot("04-landing-signed-in"));

  await page.goto("/projects");
  await page.locator(".cl-userButtonTrigger").click();
  await expect(page.locator(".cl-userButtonPopoverCard")).toBeVisible();
  await page.screenshot(shot("05-user-menu"));

  await page.goto("/profile");
  await expect(page.locator(".cl-userProfile-root")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot(shot("06-profile-account"));

  await page.goto("/profile/clip-defaults");
  await expect(page.getByRole("heading", { name: "Clip defaults" })).toBeVisible();
  await page.screenshot(shot("07-profile-clip-defaults"));

  await page.getByRole("button", { name: "Night theme" }).click();
  await page.waitForTimeout(400);
  await page.screenshot(shot("08-profile-clip-defaults-night"));
  await page.goto("/profile");
  await expect(page.locator(".cl-userProfile-root")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot(shot("09-profile-account-night"));

  await page.getByRole("button", { name: "Match device" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/profile");
  await expect(page.locator(".cl-userProfile-root")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot(shot("09b-profile-mobile"));
  await page.goto("/projects");
  await page.screenshot(shot("09c-projects-mobile"));
});

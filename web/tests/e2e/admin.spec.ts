import { expect, test } from "@playwright/test";
import { E2E_EMAIL, signIn } from "./auth";

/*
 * The admin panel. Outsiders always get a 404. The rest needs the e2e user to be a superadmin:
 * start the server with BAMIO_SUPERADMINS=bamio-e2e+clerk_test@example.com, then
 *   E2E_ADMIN=1 npx playwright test admin
 */

test("the admin panel doesn't exist for people who are signed out", async ({ page }) => {
  for (const path of ["/admin", "/admin/users", "/admin/admins"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test.describe("as a superadmin", () => {
  test.skip(!process.env.E2E_ADMIN, "Set E2E_ADMIN=1, with the server's BAMIO_SUPERADMINS naming the e2e user.");

  test("every section opens, and a free plan can be given and taken back", async ({ page }) => {
    await signIn(page);
    const status = await (await page.request.get("/api/system/status")).json();
    expect(status.admin).toBe("superadmin");

    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("AI minutes this month")).toBeVisible();

    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Users" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search users" }).fill("bamio-e2e");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: E2E_EMAIL }).click();
    await expect(page.getByRole("heading", { level: 1, name: E2E_EMAIL })).toBeVisible();

    const plan = page.getByLabel("Free plan");
    await plan.selectOption({ label: "Starter" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Free Starter given")).toBeVisible();
    await expect(page.getByText(/^Starter since/)).toBeVisible();
    await plan.selectOption({ label: "None" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Free plan taken back")).toBeVisible();

    await page.goto("/admin/jobs?view=recent");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs and errors" })).toBeVisible();
    await expect(page.getByRole("link", { name: "All recent" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Emails" }).click();
    await expect(page.getByRole("link", { name: "Emails" })).toHaveAttribute("aria-current", "page");

    await page.goto("/admin/money");
    await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Promo codes" })).toBeVisible();

    await page.goto("/admin/admins");
    await expect(page.getByRole("heading", { level: 1, name: "Admins" })).toBeVisible();
    await expect(page.getByText(E2E_EMAIL).first()).toBeVisible();
    await page.getByLabel("Add an admin").fill("nobody-here@example.com");
    await page.getByRole("button", { name: "Add admin" }).click();
    await expect(page.getByText(/No Bamio account uses that email address/)).toBeVisible();
    // The free plan given above, and taken back, are in the log.
    await expect(page.getByText("plan.revoke").first()).toBeVisible();
  });
});

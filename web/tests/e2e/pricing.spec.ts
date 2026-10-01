import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/*
 * The pricing and billing pages as the test server runs them: without a Stripe key, so plans
 * show but can't be bought, and nothing is limited. (billing.spec.ts covers plans switched on.)
 */

test("pricing shows the three plans, monthly or every 3 months", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
  await page.waitForURL(/\/pricing$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("pick a plan, start clipping.");

  const plans = page.getByRole("article");
  await expect(plans).toHaveCount(3);
  const starter = plans.filter({ has: page.getByRole("heading", { name: "Starter" }) });
  const pro = plans.filter({ has: page.getByRole("heading", { name: "Pro" }) });
  const team = plans.filter({ has: page.getByRole("heading", { name: "Team" }) });
  await expect(pro.getByText("Most popular")).toBeVisible();
  await expect(starter.getByText("$12", { exact: true })).toBeVisible();
  await expect(pro.getByText("$24", { exact: true })).toBeVisible();
  await expect(team.getByText("$54", { exact: true })).toBeVisible();
  await expect(team.getByRole("list", { name: "Team includes" })).toContainText("1,000 AI processing minutes/month");

  await page.getByRole("button", { name: "Every 3 months" }).click();
  await expect(starter.getByText("$30", { exact: true })).toBeVisible();
  await expect(starter.getByText("Save $6 compared to $36 monthly")).toBeVisible();
  await expect(pro.getByText("Save $12 compared to $72 monthly")).toBeVisible();
  await expect(team.getByText("$144", { exact: true })).toBeVisible();
  await expect(team.getByText("Save $18 compared to $162 monthly")).toBeVisible();

  // Features still being built are folded away under their own heading.
  const soon = pro.getByRole("list", { name: "Coming to Pro" });
  await expect(soon).toBeHidden();
  await pro.getByText("Coming soon").click();
  await expect(soon).toContainText("4K export");
  await expect(pro.getByRole("list", { name: "Pro includes" })).not.toContainText("4K export");

  // This server has no Stripe key: the plans can't be bought here.
  await expect(page.getByText("Payments aren’t set up on this server")).toBeVisible();
  await expect(starter.getByRole("button", { name: "Choose Starter" })).toBeDisabled();
});

test("billing explains that plans are off, and the account menu doesn't offer it", async ({ page }) => {
  await signIn(page);
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plans aren’t set up on this server" })).toBeVisible();
  // Importing isn't limited.
  await page.goto("/new");
  await expect(page.getByText("Choose a plan to import videos")).toHaveCount(0);
  await expect(page.getByText(/AI minutes left/)).toHaveCount(0);
});

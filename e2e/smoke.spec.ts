import { test, expect } from "@playwright/test";

test("redirect / -> /dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { level: 2, name: "Command Center" })).toBeVisible();
});

test("/import abre e renderiza", async ({ page }) => {
  await page.goto("/import");
  await expect(page.getByRole("heading", { level: 2, name: "Importador Excel" })).toBeVisible();
  await expect(page.getByText("Importar Excel (.xlsx)")).toBeVisible();
});

test("/h2h abre e renderiza", async ({ page }) => {
  await page.goto("/h2h");
  await expect(page.getByRole("heading", { level: 2, name: "Head-to-Head" })).toBeVisible();
});

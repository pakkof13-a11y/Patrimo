import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Métaux précieux — lots datés et fiscalité de l'article 150 VI du CGI.
 *
 * Ce que le module doit garantir, et que rien d'autre ne couvre : le poids
 * **fin** plutôt que le poids brut, l'avertissement sur les lots dont l'option
 * fiscale est déjà perdue, et le comparatif des deux régimes à la revente —
 * y compris le cas où la taxe forfaitaire frappe une vente à perte.
 */

async function resetSales(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get("/api/precious-metals/sales");
  if (!res.ok()) return;
  const body = await res.json();
  for (const sale of body.sales ?? []) {
    await request.delete(`/api/precious-metals/sales?id=${sale.id}`);
  }
}

test.describe("Métaux précieux", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await resetSales(page.request);
    await page.goto("/alternatifs?sub=metals", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("metals-section")).toBeVisible({
      timeout: 20_000,
    });
  });

  test.afterEach(async ({ page }) => {
    await resetSales(page.request);
  });

  test("agrège le métal fin, pas le poids brut", async ({ page, request }) => {
    const body = await (await request.get("/api/precious-metals")).json();
    const lines = body.lines ?? [];
    test.skip(lines.length === 0, "Pas de lot dans le seed");

    // Le titre est ce qui sépare les deux : un Napoléon au titre 900 pèse
    // moins d'or fin que son poids brut. Confondre les deux surévalue l'avoir.
    const gross = Number(body.summary.totalWeightG);
    const fine = Number(body.summary.totalFineWeightG);
    expect(fine).toBeGreaterThan(0);
    expect(fine).toBeLessThan(gross);

    await expect(page.getByTestId("metals-by-metal")).toBeVisible();
  });

  test("alerte sur les lots dont l'option fiscale est déjà perdue", async ({
    page,
  }) => {
    // Le seed contient un lingotin sans facture : à la revente, la taxe
    // forfaitaire s'imposera. L'avertissement doit tomber des années avant,
    // pas le jour où il est trop tard pour retrouver le papier.
    const warning = page.getByTestId("metals-fiscal-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/11,5/);
  });

  test("compare les deux régimes et retient le moins coûteux", async ({
    page,
    request,
  }) => {
    const body = await (await request.get("/api/precious-metals")).json();
    const lot = (body.lines ?? []).find(
      (l: { format: string; hasInvoice: boolean; acquiredAt: string | null }) =>
        l.format === "PHYSICAL" && l.hasInvoice && l.acquiredAt
    );
    test.skip(!lot, "Pas de lot physique justifié dans le seed");

    await page.getByTestId("metals-view-sales").click();
    await page.getByTestId("metals-sale-form").isVisible().catch(() => false);
    if (!(await page.getByTestId("metals-sale-form").isVisible())) {
      await page.getByRole("button", { name: /nouvelle cession/i }).click();
    }

    await page.getByTestId("metals-sale-lot").selectOption(lot.id);
    await page.getByTestId("metals-sale-quantity").fill("1");
    // Revente à perte : le régime réel n'impose rien, le forfait taxe quand même.
    await page.getByTestId("metals-sale-price").fill("100");

    const comparison = page.getByTestId("metals-tax-comparison");
    await expect(comparison).toBeVisible();
    // 100 € × 11,5 % = 11,50 €, contre 0 € au régime réel.
    await expect(page.getByTestId("metals-tax-forfait")).toContainText("11,50");
    await expect(page.getByTestId("metals-tax-plus_value")).toContainText("0,00");
    await expect(page.getByTestId("metals-tax-plus_value")).toContainText(
      /régime retenu/i
    );
  });

  test("ferme l'option et chiffre le surcoût quand la facture manque", async ({
    page,
    request,
  }) => {
    const body = await (await request.get("/api/precious-metals")).json();
    const lot = (body.lines ?? []).find(
      (l: { format: string; hasInvoice: boolean; acquiredAt: string | null }) =>
        l.format === "PHYSICAL" && !l.hasInvoice && l.acquiredAt
    );
    test.skip(!lot, "Pas de lot sans facture dans le seed");

    await page.getByTestId("metals-view-sales").click();
    if (!(await page.getByTestId("metals-sale-form").isVisible())) {
      await page.getByRole("button", { name: /nouvelle cession/i }).click();
    }
    await page.getByTestId("metals-sale-lot").selectOption(lot.id);
    await page.getByTestId("metals-sale-quantity").fill("1");
    await page.getByTestId("metals-sale-price").fill("100");

    // Le régime réel serait gratuit, mais il est fermé : l'écran doit le dire
    // plutôt que de recommander l'inaccessible.
    await expect(page.getByTestId("metals-tax-plus_value")).toContainText(
      /facture nominative/i
    );
    await expect(page.getByTestId("metals-tax-forfait")).toContainText(
      /régime retenu/i
    );
    await expect(page.getByTestId("metals-tax-rationale")).toContainText(
      /justificatif/i
    );
  });

  test("enregistrer une cession décrémente le lot et alimente l'année fiscale", async ({
    page,
    request,
  }) => {
    const before = await (await request.get("/api/precious-metals")).json();
    const lot = (before.lines ?? []).find(
      (l: { format: string; quantity: string }) =>
        l.format === "PHYSICAL" && Number(l.quantity) >= 2
    );
    test.skip(!lot, "Pas de lot cessible dans le seed");

    await page.getByTestId("metals-view-sales").click();
    if (!(await page.getByTestId("metals-sale-form").isVisible())) {
      await page.getByRole("button", { name: /nouvelle cession/i }).click();
    }
    await page.getByTestId("metals-sale-lot").selectOption(lot.id);
    await page.getByTestId("metals-sale-quantity").fill("1");
    await page.getByTestId("metals-sale-price").fill("5000");
    await page.getByTestId("metals-sale-submit").click();

    await expect(page.getByText("Cession enregistrée")).toBeVisible({
      timeout: 15_000,
    });

    // Le stock doit baisser : une vente qui laisserait le lot intact ferait
    // apparaître deux fois le même métal au patrimoine.
    const after = await (await request.get("/api/precious-metals")).json();
    const lotAfter = after.lines.find((l: { id: string }) => l.id === lot.id);
    expect(Number(lotAfter.quantity)).toBe(Number(lot.quantity) - 1);

    await expect(page.getByTestId("metals-fiscal-years")).toBeVisible();
    await expect(page.getByTestId("metals-sales-table")).toBeVisible();
  });

  test("crée un lot daté depuis le formulaire", async ({ page }) => {
    await page.getByTestId("metals-add").click();
    await expect(page.getByTestId("metals-form")).toBeVisible();

    await page.getByTestId("metals-metal").selectOption("SILVER");
    await page.getByTestId("metals-denomination").fill("Test Maple 1 oz");
    await page.getByTestId("metals-fineness").fill("999");
    await page.getByTestId("metals-quantity").fill("3");
    await page.getByTestId("metals-acquired-at").fill("2020-05-10");
    await page.getByTestId("metals-pru").fill("30");
    await page.getByTestId("metals-current-value").fill("120");
    await page.getByTestId("metals-has-invoice").check();
    await page.getByTestId("metals-submit").click();

    await expect(page.getByText("Lot ajouté")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId("precious-metals-table")
    ).toContainText("Test Maple 1 oz");

    // Nettoyage : le lot ne doit pas polluer les tests suivants.
    const body = await (await page.request.get("/api/precious-metals")).json();
    const created = body.lines.find(
      (l: { denomination: string }) => l.denomination === "Test Maple 1 oz"
    );
    if (created) {
      await page.request.delete(`/api/precious-metals?id=${created.id}`);
    }
  });
});

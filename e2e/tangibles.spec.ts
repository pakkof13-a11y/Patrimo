import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Actifs tangibles — formulaire conditionnel et fiscalité par objet.
 *
 * Deux invariants que rien d'autre ne couvre : les champs affichés dépendent
 * réellement de la catégorie, et les exonérations sont annoncées plutôt qu'un
 * impôt inventé — sous 5 000 €, et pour un véhicule d'usage.
 */

test.describe("Tangibles & collection", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/alternatifs?sub=tangibles", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tangibles-section")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("n'annonce aucun impôt sous le seuil de 5 000 €", async ({ page, request }) => {
    const body = await (await request.get("/api/tangibles")).json();
    const small = (body.lines ?? []).find(
      (l: { estimatedValue: string; tax: { exemptionReason: string | null } }) =>
        l.tax.exemptionReason === "SMALL_SALE"
    );
    test.skip(!small, "Pas d'objet sous le seuil dans le seed");

    // Le gain est positif, et pourtant rien n'est dû : c'est toute la
    // différence entre un simulateur juste et un simulateur qui applique un
    // taux mécaniquement.
    expect(Number(small.unrealizedPnl)).toBeGreaterThan(0);
    expect(small.tax.taxDueEur).toBe("0.00");
    expect(small.tax.exempt).toBe(true);
  });

  test("exonère le véhicule d'usage et impose celui de collection", async ({
    request,
  }) => {
    const body = await (await request.get("/api/tangibles")).json();
    const cars = (body.lines ?? []).filter(
      (l: { category: string }) => l.category === "AUTO"
    );
    test.skip(cars.length < 2, "Le seed doit contenir les deux véhicules");

    const daily = cars.find((c: { isCollectible: boolean }) => !c.isCollectible);
    const collectible = cars.find((c: { isCollectible: boolean }) => c.isCollectible);

    // Art. 150 UA II 1° : la voiture ordinaire ne supporte rien, malgré la
    // plus-value. La même catégorie, qualifiée de collection, est imposée.
    expect(daily.tax.exempt).toBe(true);
    expect(daily.tax.exemptionReason).toBe("NATURE");
    expect(collectible.tax.exempt).toBe(false);
    expect(Number(collectible.tax.taxDueEur)).toBeGreaterThan(0);
  });

  test("adapte les champs du formulaire à la catégorie", async ({ page }) => {
    await page.getByTestId("tangible-add").click();
    await expect(page.getByTestId("tangible-form")).toBeVisible();

    await page.getByTestId("tangible-category").selectOption("WATCHES");
    await page.getByTestId("tangible-brand").fill("Test Marque");
    await page.getByTestId("tangible-model").fill("Test Modèle");
    await page.getByRole("button", { name: /suivant/i }).click();

    // Une montre montre sa référence, pas un carat.
    await expect(page.getByTestId("tangible-watch-fields")).toBeVisible();
    await expect(page.getByTestId("tangible-gem-fields")).toHaveCount(0);

    // Une pierre fait l'inverse — et le formulaire doit suivre le changement
    // de catégorie sans être rouvert.
    await page.getByRole("button", { name: /précédent/i }).click();
    await page.getByTestId("tangible-category").selectOption("GEMSTONE");
    await page.getByRole("button", { name: /suivant/i }).click();
    await expect(page.getByTestId("tangible-gem-fields")).toBeVisible();
    await expect(page.getByTestId("tangible-watch-fields")).toHaveCount(0);

    // Le basculement fiscal n'est proposé que là où il change quelque chose.
    await expect(page.getByTestId("tangible-collectible-toggle")).toHaveCount(0);
    await page.getByRole("button", { name: /précédent/i }).click();
    await page.getByTestId("tangible-category").selectOption("AUTO");
    await page.getByRole("button", { name: /suivant/i }).click();
    await expect(page.getByTestId("tangible-collectible-toggle")).toBeVisible();
  });

  test("le récapitulatif chiffre la revente avant d'enregistrer", async ({ page }) => {
    await page.getByTestId("tangible-add").click();
    await page.getByTestId("tangible-category").selectOption("ART");
    await page.getByTestId("tangible-brand").fill("Test Artiste");
    await page.getByTestId("tangible-model").fill("Toile e2e");

    for (let i = 0; i < 2; i += 1) {
      await page.getByRole("button", { name: /suivant/i }).click();
    }
    await page.getByTestId("tangible-purchase-date").fill("2015-04-01");
    await page.getByTestId("tangible-purchase-price").fill("10000");
    await page.getByTestId("tangible-has-certificate").check();
    await page.getByRole("button", { name: /suivant/i }).click();
    await page.getByTestId("tangible-estimated-value").fill("30000");
    await page.getByRole("button", { name: /suivant/i }).click();

    const sim = page.getByTestId("tangible-tax-sim");
    await expect(sim).toBeVisible();
    // 30 000 × 6,5 % = 1 950 € au forfait ; le régime réel taxerait
    // 20 000 € abattus de 45 % (11 ans) à 37,6 %, soit davantage.
    await expect(sim).toContainText("1 950,00");
  });

  test("crée un objet et déplie ses détails spécifiques", async ({ page }) => {
    await page.getByTestId("tangible-add").click();
    await page.getByTestId("tangible-category").selectOption("GEMSTONE");
    await page.getByTestId("tangible-brand").fill("Test Lapidaire");
    await page.getByTestId("tangible-model").fill("Saphir e2e");
    await page.getByRole("button", { name: /suivant/i }).click();

    await page.getByTestId("tangible-gem-type").selectOption("SAPPHIRE");
    await page.getByTestId("tangible-carat").fill("2.5");
    await page.getByRole("button", { name: /suivant/i }).click();
    await page.getByTestId("tangible-purchase-price").fill("4000");
    await page.getByRole("button", { name: /suivant/i }).click();
    await page.getByTestId("tangible-estimated-value").fill("6000");
    await page.getByRole("button", { name: /suivant/i }).click();
    await page.getByRole("button", { name: /créer l’actif/i }).click();

    await expect(page.getByText("Actif ajouté")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("tangible-row").filter({ hasText: "Saphir e2e" });
    await expect(row).toHaveCount(1);
    await row.click();

    // Les caractéristiques n'apparaissent qu'une fois la ligne dépliée : la
    // vue repliée ne porte que ce qui se compare d'une catégorie à l'autre.
    const details = page.getByTestId("tangible-row-details");
    await expect(details).toBeVisible();
    await expect(details).toContainText("Saphir");
    await expect(details).toContainText("2.5");

    const body = await (await page.request.get("/api/tangibles")).json();
    const created = body.lines.find(
      (l: { modelName: string }) => l.modelName === "Saphir e2e"
    );
    if (created) await page.request.delete(`/api/tangibles?id=${created.id}`);
  });
});

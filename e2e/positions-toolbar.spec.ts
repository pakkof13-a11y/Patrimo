import { test, expect } from "@playwright/test";
import { gotoDashboard, clickNav, selectEnvelopeFilter } from "./helpers";

/**
 * Interactions critiques vue Positions (toolbar hiérarchisée).
 */
test.describe("Positions — toolbar & filtres", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await clickNav(page, "Positions");
    await expect(page).toHaveURL(/\/positions/);
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("toolbar hiérarchisée : recherche, enveloppe, colonnes", async ({
    page,
  }) => {
    await expect(page.getByTestId("holdings-toolbar")).toBeVisible();
    await expect(page.getByTestId("holdings-count-badge")).toBeVisible();

    // Recherche
    const search = page.getByTestId("table-search");
    await expect(search).toBeVisible();
    await search.fill("___no_match_zzz___");
    await expect(page.getByTestId("holdings-empty")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("holdings-empty")).toHaveAttribute(
      "data-empty-kind",
      "filter"
    );
    await page.getByTestId("holdings-empty-clear-search").click();
    await expect(search).toHaveValue("");

    // Enveloppe (button + listbox multi-cases, plus de <select>)
    const env = page.getByTestId("envelope-select");
    await expect(env).toBeVisible();
    await selectEnvelopeFilter(page, "PEA");
    await expect(page).toHaveURL(/envelope=pea|positions\/pea|pea/i);
    // Libellé du bouton = enveloppe unique sélectionnée
    await expect(env).toContainText(/PEA/i);

    // Colonnes
    await page.getByTestId("column-picker").click();
    await expect(page.getByTestId("column-picker-menu")).toBeVisible();
    await expect(page.getByTestId("column-picker-optional")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("vignette de tendance : affichée d'emblée, décochable, et le choix tient", async ({
    page,
  }) => {
    const cells = page.locator('td[data-column-id="trend"]');
    await expect(cells.first()).toBeVisible();

    /*
      Ni verrouillée ni cachée par défaut. C'est un cas que le tableau ne
      connaissait pas : « obligatoire » y valait « indécochable ». Le test
      tient les deux bouts — la case doit être cochée *et* active.
    */
    const row = page
      .getByTestId("column-picker-menu")
      .locator("li")
      .filter({ hasText: "Tendance" });

    await page.getByTestId("column-picker").click();
    await expect(page.getByTestId("column-picker-menu")).toBeVisible();
    const box = row.locator('input[type="checkbox"]');
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled();

    await box.click();
    await expect(cells).toHaveCount(0);

    // Le réglage doit survivre au rechargement : une case qui se recoche
    // toute seule à la visite suivante n'est pas un réglage.
    await page.reload();
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 15_000,
    });
    await expect(cells).toHaveCount(0);

    await page.getByTestId("column-picker").click();
    await row.locator('input[type="checkbox"]').click();
    await page.keyboard.press("Escape");
    await expect(cells.first()).toBeVisible();
  });

  test("regroupement par classe d'actifs par défaut", async ({ page }) => {
    // Le portefeuille s'ouvre groupé : des en-têtes de classe, et une
    // pagination inactive puisque toutes les lignes sont rendues.
    const groups = page.locator("[data-testid^='class-group-header-']");
    await expect(groups.first()).toBeVisible();

    const first = groups.first();
    const toggle = first.locator("[data-testid^='class-group-toggle-']");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const rowsExpanded = await page.locator("tbody tr").count();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await page.locator("tbody tr").count()).toBeLessThan(rowsExpanded);

    // Le clic sur la ligne entière rouvre le groupe.
    await first.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("options avancées : regroupement et page size", async ({ page }) => {
    await page.getByTestId("holdings-advanced-toggle").click();
    await expect(page.getByTestId("holdings-advanced-panel")).toBeVisible();

    // La pagination n'existe qu'à plat : sortir du regroupement d'abord.
    await page.getByTestId("holdings-group-by").selectOption("none");
    const pageSize = page.getByTestId("holdings-page-size");
    await expect(pageSize).toBeVisible();
    await pageSize.selectOption("10");
    await expect(pageSize).toHaveValue("10");

    await page.getByTestId("holdings-group-by").selectOption("assetCategory");
    /*
      Le regroupement doit produire des en-têtes. La condition « peut être 0 si
      pas de données classifiées » rendait ce contrôle sans effet le jour où le
      regroupement cesserait d'en produire — 9 en-têtes mesurés sur le jeu de
      démonstration, qui porte des positions classées.
    */
    const groups = page.locator("[data-testid^='category-group-header-']");
    await expect(
      groups.first(),
      "regroupement par catégorie : au moins un en-tête de groupe est attendu"
    ).toBeVisible({ timeout: 10_000 });
    // Group mode hides page-size and shows disabled notice
    await expect(page.getByTestId("holdings-page-size")).toHaveCount(0);
    await expect(page.getByTestId("holdings-page-size-disabled")).toBeVisible();
  });

  test("astuces discrètes (pas de mur de doc)", async ({ page }) => {
    // Pas de bandeau doc permanent
    await expect(
      page.getByText(/Flèche = dernières transactions/i)
    ).toHaveCount(0);

    await page.getByTestId("holdings-tips-toggle").click();
    await expect(page.getByTestId("holdings-tips-panel")).toBeVisible();
    await expect(page.getByText(/Raccourcis utiles/i)).toBeVisible();
  });

  test("pagination sans Page 0 / 0", async ({ page }) => {
    // La pagination ne s'affiche qu'en vue à plat (regroupée, toutes les
    // lignes sont rendues d'un coup).
    await page.getByTestId("holdings-advanced-toggle").click();
    await page.getByTestId("holdings-group-by").selectOption("none");

    const label = page.getByTestId("holdings-page-label");
    await expect(label).toBeVisible();
    await expect(label).not.toHaveText(/Page\s*0\s*\/\s*0/i);
  });
});

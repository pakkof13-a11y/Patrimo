import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Banques — vue de trésorerie patrimoniale.
 *
 * Couvre les mêmes garanties qu'avant la refonte : confirmation avant
 * suppression, solde réellement contrôlé à la saisie, KPI cohérents avec
 * l'API, plafonds réglementaires, garde-fou sur un taux invraisemblable,
 * historique des mouvements, validation des dates d'un dépôt à terme.
 *
 * Les parcours ont changé de forme, pas de fond : la création passe par le
 * menu « Ajouter » puis une fenêtre, et la modification par le panneau de
 * détail au lieu de champs alignés dans la liste.
 */

/** Ouvre la fenêtre de création correspondante depuis le menu « Ajouter ». */
async function openAddModal(
  page: Page,
  kind: "checking" | "savings" | "term_deposit"
) {
  await page.getByTestId("banks-add-open").click();
  await page.getByTestId(`banks-add-${kind}`).click();
}

/**
 * Sélectionne un produit dans la liste et attend l'ouverture de son panneau.
 *
 * La ligne porte désormais son libellé en texte — plus dans la `value` d'un
 * `<input>` —, donc `hasText` suffit là où il fallait auparavant filtrer sur
 * un attribut.
 */
async function selectProduct(page: Page, label: string) {
  const row = page
    .getByTestId("bank-product-row")
    .filter({ hasText: label })
    .first();
  await row.click();
  await expect(page.getByTestId("bank-detail-panel")).toHaveAttribute(
    "data-open",
    "true"
  );
  return row;
}

async function selectInstitution(page: Page, name: string) {
  const row = page
    .getByTestId("bank-institution-row")
    .filter({ hasText: name })
    .first();
  await row.click();
  return row;
}

test.describe("Banques", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/banques", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("banks-tab")).toBeVisible({ timeout: 30_000 });
  });

  test("la page s'ouvre sur la synthèse par établissement", async ({ page }) => {
    /*
      C'est le renversement de la refonte : le premier niveau de lecture est
      l'établissement, pas trois listes de produits côte à côte.
    */
    await expect(page.getByTestId("banks-view-overview")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(page.getByTestId("bank-institution-list")).toBeVisible();

    // Rien de sélectionné à l'arrivée : le panneau reste en retrait.
    await expect(page.getByTestId("bank-detail-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("sélectionner un établissement puis l'un de ses produits", async ({
    page,
  }) => {
    await openAddModal(page, "checking");
    await page.getByTestId("banks-add-bank-name").fill("E2E Panel Bank");
    await page.getByTestId("banks-add-balance").fill("1500");
    await page.getByTestId("banks-add-submit").click();

    await selectInstitution(page, "E2E Panel Bank");
    const panel = page.getByTestId("bank-detail-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(panel).toContainText("E2E Panel Bank");

    // Depuis la fiche de l'établissement, ouvrir le produit rattaché.
    await page.getByTestId("bank-panel-product-link").first().click();
    await expect(panel).toContainText("Compte courant");

    // Fermer vide la sélection sans quitter la page.
    await page.getByTestId("bank-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("banks-tab")).toBeVisible();

    await selectProduct(page, "Compte courant");
    await page.getByTestId("bank-panel-delete").click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
  });

  test("suppression d'un compte courant exige confirmation", async ({
    page,
  }) => {
    await openAddModal(page, "checking");
    await page.getByTestId("banks-add-bank-name").fill("E2E Delete Bank");
    await page.getByTestId("banks-add-balance").fill("500");
    await page.getByTestId("banks-add-submit").click();

    await selectInstitution(page, "E2E Delete Bank");
    await page.getByTestId("bank-panel-product-link").first().click();
    await page.getByTestId("bank-panel-delete").click();

    const confirm = page.getByTestId("banks-delete-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("E2E Delete Bank");

    // Annuler ne supprime rien.
    await page.getByTestId("banks-delete-confirm-cancel").click();
    await expect(page.getByTestId("bank-institution-list")).toContainText(
      "E2E Delete Bank"
    );

    await page.getByTestId("bank-panel-delete").click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
    await expect(page.getByTestId("bank-institution-list")).not.toContainText(
      "E2E Delete Bank",
      { timeout: 20_000 }
    );
  });

  test("le solde se modifie depuis le panneau de détail", async ({ page }) => {
    await openAddModal(page, "checking");
    await page.getByTestId("banks-add-bank-name").fill("E2E Edit Bank");
    await page.getByTestId("banks-add-balance").fill("1000");
    await page.getByTestId("banks-add-submit").click();

    await selectInstitution(page, "E2E Edit Bank");
    await page.getByTestId("bank-panel-product-link").first().click();

    /*
      Le champ est réellement contrôlé : la frappe reste à l'écran, et la
      validation ne part qu'au blur. C'est le bug d'origine — un `defaultValue`
      remonté par le serveur écrasait la saisie en cours.
    */
    const balance = page.getByTestId("bank-panel-balance");
    await balance.fill("2500");
    await expect(balance).toHaveValue("2500");
    await balance.blur();

    await expect(page.getByTestId("bank-panel-amount")).toContainText("2 500", {
      timeout: 20_000,
    });

    await page.getByTestId("bank-panel-delete").click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
  });

  test("KPI de synthèse cohérents avec l'API", async ({ page, request }) => {
    const banksApi = await request.get("/api/banks").then((r) => r.json());
    const summaryApi = await request
      .get("/api/banks/summary")
      .then((r) => r.json());

    const expectedChecking = banksApi.accounts
      .filter((a: { countsInNetWorth: boolean }) => a.countsInNetWorth)
      .reduce(
        (s: number, a: { balanceBase: string }) => s + Number(a.balanceBase),
        0
      );
    expect(Number(summaryApi.checkingTotalBase)).toBeCloseTo(
      expectedChecking,
      1
    );

    const strip = page.getByTestId("banks-summary-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Liquidités");
    await expect(strip).toContainText("Établissements");
  });

  test("livret réglementé : plafond auto-rempli, plafond visible au détail", async ({
    page,
  }) => {
    await openAddModal(page, "savings");
    await page
      .getByTestId("banks-savings-add-producttype")
      .selectOption("LIVRET_A");
    await expect(page.getByTestId("banks-savings-add-ceiling")).toHaveValue(
      "22950"
    );

    await page.getByTestId("banks-savings-add-name").fill("E2E Livret A");
    // Solde proche du plafond : la barre doit passer en alerte dans le panneau.
    await page.getByTestId("banks-savings-add-balance").fill("22000");
    await page.getByTestId("banks-savings-add-submit").click();

    await selectProduct(page, "E2E Livret A");
    const panel = page.getByTestId("bank-detail-panel");
    await expect(panel).toContainText("Plafond");
    await expect(panel).toContainText("% du plafond");

    await page.getByTestId("bank-panel-delete").click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
  });

  test("un taux invraisemblable est signalé à la saisie", async ({ page }) => {
    await openAddModal(page, "savings");
    await page
      .getByTestId("banks-savings-add-producttype")
      .selectOption("LIVRET_A");

    await page.getByTestId("banks-savings-add-apy").fill("35");
    await expect(page.getByTestId("banks-savings-rate-warning")).toBeVisible();

    await page.getByTestId("banks-savings-add-apy").fill("2.4");
    await expect(page.getByTestId("banks-savings-rate-warning")).toHaveCount(0);
  });

  test("l'historique d'un compte est visible depuis son panneau", async ({
    page,
  }) => {
    await openAddModal(page, "checking");
    await page.getByTestId("banks-add-bank-name").fill("E2E History Bank");
    await page.getByTestId("banks-add-balance").fill("2000");
    await page.getByTestId("banks-add-submit").click();

    await selectInstitution(page, "E2E History Bank");
    await page.getByTestId("bank-panel-product-link").first().click();

    // Un changement de solde crée un mouvement côté serveur.
    const balance = page.getByTestId("bank-panel-balance");
    await balance.fill("3200");
    await balance.blur();

    await expect(page.getByTestId("bank-panel-history-row").first()).toBeVisible(
      { timeout: 20_000 }
    );

    await page.getByTestId("bank-panel-history-full").click();
    await expect(page.getByTestId("account-history-modal")).toBeVisible();
    await expect(
      page.getByTestId("account-history-row").first()
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("bank-panel-delete").click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
  });

  test("dépôt à terme : dates validées, échéance affichée, suppression", async ({
    page,
  }) => {
    await openAddModal(page, "term_deposit");
    await page.getByTestId("banks-cat-add-principal").fill("5000");
    await page.getByTestId("banks-cat-add-rate").fill("3.5");
    await page.getByTestId("banks-cat-add-opened").fill("2027-01-01");
    // Échéance antérieure à l'ouverture : la route doit refuser.
    await page.getByTestId("banks-cat-add-maturity").fill("2026-01-01");
    await page.getByTestId("banks-cat-add-submit").click();
    await expect(page.getByText(/postérieure/i)).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("banks-cat-add-opened").fill("2026-01-01");
    await page.getByTestId("banks-cat-add-maturity").fill("2027-06-01");
    await page.getByTestId("banks-cat-add-submit").click();

    await page.getByTestId("banks-view-term").click();
    const table = page.getByTestId("bank-product-table");
    await expect(table).toContainText("5 000,00 €", { timeout: 20_000 });

    await page.getByTestId("bank-table-row").first().click();
    const panel = page.getByTestId("bank-detail-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    // La frise d'échéance est le repère propre au dépôt à terme.
    await expect(page.getByTestId("term-deposit-countdown")).toBeVisible();

    await page.getByTestId("bank-panel-delete").click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
  });

  test("les sous-onglets filtrent la même liste", async ({ page }) => {
    await page.getByTestId("banks-view-checking").click();
    await expect(page.getByTestId("banks-view-checking")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(page.getByTestId("bank-institution-list")).toHaveCount(0);

    await page.getByTestId("banks-view-overview").click();
    await expect(page.getByTestId("bank-institution-list")).toBeVisible();
  });

  test("des totaux illisibles ne s'affichent pas à zéro euro", async ({ page }) => {
    /*
      Trois états, pas deux : le garde `isPending && !data` ne couvre que le
      premier chargement. Une fois les tentatives épuisées, il retombe à faux
      alors que le résumé reste absent — c'est l'échec, et les tuiles lisaient
      alors `?? "0"`.

      Mesuré avant correction : « 0,00 € » de liquidités et d'épargne, sur un
      écran qui ne signale l'échec nulle part. La route rend toujours ces
      totaux, à zéro compris quand il n'y a aucun compte : leur absence
      signifie « pas de réponse », jamais « rien ».

      Le test attend la **fin réelle** du chargement — plus aucune tuile en
      `data-loading` — sans quoi il constaterait le squelette et passerait pour
      une mauvaise raison, ce qui a d'abord été le cas.
    */
    await page.route("**/api/banks/summary**", (route) =>
      route.fulfill({ status: 500, json: { error: "indisponible" } })
    );
    await page.goto("/banques", { waitUntil: "domcontentloaded" });

    const bande = page.getByTestId("banks-summary-strip");
    await expect(bande).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => bande.locator("[data-loading='true']").count(), {
        timeout: 30_000,
      })
      .toBe(0);

    await expect(
      bande,
      "des totaux inconnus ne s'écrivent pas « 0,00 € »"
    ).not.toContainText("0,00");
  });

});

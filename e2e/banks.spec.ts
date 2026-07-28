import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Chantier Banques P1 : bugs critiques (suppression sans confirmation, input
 * non contrôlé), KPI de synthèse, plafonds réglementaires + barre de
 * progression, comptes pro/joint, dépôts à terme, historique des mouvements.
 */
/**
 * Trouve la ligne d'un compte courant / livret par le nom saisi dans son
 * combobox. `hasText` ne marche pas ici : le nom vit dans la `value` d'un
 * `<input>` (BankNameCombobox / EditableField), pas dans un nœud texte — un
 * `<input>` n'expose jamais sa valeur via innerText/textContent.
 */
function rowByInputValue(page: import("@playwright/test").Page, tag: string, value: string) {
  return page.locator(tag).filter({ has: page.locator(`input[value="${value}"]`) });
}

test.describe("Banques", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/banques", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("banks-tab")).toBeVisible({ timeout: 30_000 });
  });

  test("suppression d'un compte courant exige confirmation", async ({
    page,
  }) => {
    await page.getByTestId("banks-add-bank-name").fill("E2E Delete Bank");
    await page.getByTestId("banks-add-balance").fill("500");
    await page.getByTestId("banks-add-submit").click();

    const row = rowByInputValue(page, "tr", "E2E Delete Bank");
    await expect(row).toBeVisible({ timeout: 20_000 });

    const deleteBtn = row.locator('[data-testid^="banks-delete-"]');
    await deleteBtn.click();

    // Le dialog doit apparaître avec le nom et le solde — pas de suppression immédiate.
    await expect(page.getByTestId("banks-delete-confirm")).toBeVisible();
    await expect(page.getByTestId("banks-delete-confirm")).toContainText(
      "E2E Delete Bank"
    );
    await expect(row).toBeVisible(); // toujours là tant qu'on n'a pas confirmé

    await page.getByTestId("banks-delete-confirm-cancel").click();
    await expect(row).toBeVisible(); // annulé → rien supprimé

    await deleteBtn.click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
    await expect(row).toHaveCount(0);
  });

  test("l'édition du solde ne se réinitialise pas pendant la saisie", async ({
    page,
  }) => {
    await page.getByTestId("banks-add-bank-name").fill("E2E Edit Bank");
    await page.getByTestId("banks-add-balance").fill("1000");
    await page.getByTestId("banks-add-submit").click();

    const row = rowByInputValue(page, "tr", "E2E Edit Bank");
    await expect(row).toBeVisible({ timeout: 20_000 });

    const balanceInput = row.locator('[data-testid^="banks-balance-"]');
    await balanceInput.fill("1500.5");
    await balanceInput.blur();
    // Laisser le PATCH + refetch se terminer, puis vérifier que le champ
    // affiche toujours la valeur saisie (pas de remount vers "1000").
    await page.waitForTimeout(2000);
    await expect(balanceInput).toHaveValue("1500.5");

    await row.locator('[data-testid^="banks-delete-"]').click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
  });

  test("KPI de synthèse cohérents avec la liste des comptes", async ({
    page,
    request,
  }) => {
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

    await expect(page.getByTestId("banks-summary-strip")).toBeVisible();
    await expect(page.getByTestId("banks-summary-strip")).toContainText(
      "Liquidités"
    );
  });

  test("livret réglementé : plafond auto-rempli et barre de progression", async ({
    page,
  }) => {
    await page.getByTestId("banks-savings-add-producttype").selectOption(
      "LIVRET_A"
    );
    // Le plafond légal doit s'auto-remplir dès la sélection du produit.
    await expect(page.getByTestId("banks-savings-add-ceiling")).toHaveValue(
      "22950"
    );

    await page.getByTestId("banks-savings-add-name").fill("E2E Livret A");
    await page.getByTestId("banks-savings-add-balance").fill("22000"); // solde proche du plafond
    await page.getByTestId("banks-savings-add-submit").click();

    const row = rowByInputValue(page, "li", "E2E Livret A");
    await expect(row).toBeVisible({ timeout: 20_000 });
    // Solde proche du plafond (22000/22950 ≈ 95.9%) → alerte visible.
    await expect(row).toContainText("% du plafond");

    await row.locator('[data-testid^="savings-delete-"]').click();
    await page.getByTestId("savings-delete-confirm-confirm").click();
  });

  test("livret : taux aberrant signalé", async ({ page }) => {
    await page.getByTestId("banks-savings-add-producttype").selectOption(
      "LIVRET_A"
    );
    await page.getByTestId("banks-savings-add-apy").fill("35");
    await expect(page.getByTestId("banks-savings-rate-warning")).toBeVisible();

    await page.getByTestId("banks-savings-add-apy").fill("2.4");
    await expect(page.getByTestId("banks-savings-rate-warning")).toHaveCount(0);
  });

  test("historique : ouverture puis dépôt apparaissent après édition du solde", async ({
    page,
  }) => {
    await page.getByTestId("banks-add-bank-name").fill("E2E History Bank");
    await page.getByTestId("banks-add-balance").fill("2000");
    await page.getByTestId("banks-add-submit").click();

    const row = rowByInputValue(page, "tr", "E2E History Bank");
    await expect(row).toBeVisible({ timeout: 20_000 });

    const balanceInput = row.locator('[data-testid^="banks-balance-"]');
    await balanceInput.fill("2500");
    await balanceInput.blur();
    await page.waitForTimeout(2000);

    await row.locator('[data-testid^="banks-history-"]').click();
    await expect(page.getByTestId("account-history-modal")).toBeVisible();
    const rows = page.getByTestId("account-history-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Dépôt");
    await expect(rows.nth(1)).toContainText("Ouverture");

    await page.keyboard.press("Escape");
    await row.locator('[data-testid^="banks-delete-"]').click();
    await page.getByTestId("banks-delete-confirm-confirm").click();
  });

  test("dépôt à terme : validation des dates et suppression", async ({
    page,
  }) => {
    await page.getByTestId("banks-cat-add-principal").fill("5000");
    await page.getByTestId("banks-cat-add-rate").fill("3.5");
    await page
      .getByTestId("banks-cat-add-opened")
      .fill("2027-01-01");
    await page
      .getByTestId("banks-cat-add-maturity")
      .fill("2026-01-01"); // avant l'ouverture → doit échouer
    await page.getByTestId("banks-cat-add-submit").click();
    await expect(page.getByText(/postérieure/i)).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("banks-cat-add-opened").fill("2026-01-01");
    await page.getByTestId("banks-cat-add-maturity").fill("2027-06-01");
    await page.getByTestId("banks-cat-add-submit").click();

    const row = page.getByTestId("banks-cat-row").filter({ hasText: "5" });
    await expect(page.getByTestId("banks-cat-list")).toContainText(
      "5 000,00 €",
      { timeout: 20_000 }
    );

    const anyRow = page.getByTestId("banks-cat-row").first();
    await anyRow.locator('[data-testid^="banks-cat-delete-"]').click();
    await page.getByTestId("banks-cat-delete-confirm-confirm").click();
  });
});

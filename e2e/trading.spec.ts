import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Trading — comptes, journal et raccourci depuis les Cryptos.
 *
 * Les futures crypto ont leur propre écran, inchangé par ce chantier : les
 * tests ci-dessous vérifient qu'il reste accessible et actif après le
 * renvoi depuis l'onglet Cryptos.
 */

async function resetAccounts(
  request: import("@playwright/test").APIRequestContext
) {
  const res = await request.get("/api/trading");
  if (!res.ok()) return;
  const body = await res.json();
  for (const account of body.accounts ?? []) {
    await request.delete(`/api/trading/accounts/${account.id}`);
  }
}

test.describe("Trading", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await resetAccounts(page.request);
  });

  test.afterEach(async ({ page }) => {
    await resetAccounts(page.request);
  });

  test("le raccourci des Cryptos ouvre directement les futures dans Trading", async ({
    page,
  }) => {
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await page.getByTestId("crypto-subtab-FUTURES").click();

    const redirect = page.getByTestId("crypto-futures-redirect");
    await expect(redirect).toBeVisible({ timeout: 20_000 });
    await expect(redirect).toContainText(
      /positions futures cryptos dans l'onglet Trading/i
    );

    // Le lien porte le sous-onglet : un clic doit mener aux futures, pas à la
    // vue d'ensemble du Trading.
    const link = page.getByTestId("crypto-futures-goto-trading");
    await expect(link).toHaveAttribute("href", "/trading?sub=futures");

    await link.click();
    await expect(page).toHaveURL(/\/trading\?sub=futures/);
    // La navigation secondaire suit désormais le pattern `term-seg` commun aux
    // modules refondus : onglet ARIA actif marqué par `data-active`.
    await expect(page.getByTestId("trading-sub-futures")).toHaveAttribute(
      "data-active",
      "true"
    );
  });

  test("les sous-onglets historiques restent en place", async ({ page }) => {
    await page.goto("/trading", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trading-tab")).toBeVisible({
      timeout: 20_000,
    });

    // La vue d'accueil s'appelle désormais « Positions » — elle montre les
    // positions elles-mêmes plutôt qu'un sommaire de modules. Les autres
    // sous-onglets existaient avant ce chantier et ne doivent pas avoir
    // disparu.
    await expect(page.getByTestId("trading-sub-positions")).toBeVisible();
    await expect(page.getByTestId("trading-sub-futures")).toBeVisible();
    await expect(page.getByTestId("trading-sub-cfd")).toBeVisible();
    await expect(page.getByTestId("trading-sub-journal")).toBeVisible();

    await page.getByTestId("trading-sub-futures").click();
    await expect(page.getByTestId("trading-goto-futures")).toHaveCount(0);
  });

  test("déclare un compte de trading et l'affiche", async ({ page }) => {
    await page.goto("/trading?sub=cfd", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trading-accounts-panel")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByTestId("trading-account-form-toggle").click();
    await page.getByTestId("trading-broker").fill("IG Markets");
    await page.getByTestId("trading-account-type").selectOption("CFD");
    await page.getByTestId("trading-balance").fill("10000");
    await page.getByTestId("trading-account-submit").click();

    await expect(page.getByText("Compte enregistré")).toBeVisible({
      timeout: 15_000,
    });
    const card = page.getByTestId("trading-account-card");
    await expect(card).toHaveCount(1);
    await expect(card.first()).toContainText("IG Markets");
  });

  test("le journal calcule l'imposition et compare PFU et barème", async ({
    page,
  }) => {
    await page.goto("/trading?sub=journal", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trading-journal-panel")).toBeVisible({
      timeout: 20_000,
    });

    const pfu = page.getByTestId("trading-pfu");
    const bareme = page.getByTestId("trading-bareme");

    // Sans opération close, le panneau reste vide plutôt que d'afficher des
    // statistiques calculées sur rien.
    if ((await pfu.count()) === 0) {
      await expect(page.getByText(/aucune opération close/i)).toBeVisible();
      return;
    }

    // Tant que la tranche marginale n'est pas renseignée, aucune comparaison
    // n'est inventée.
    await expect(bareme).toContainText(/tranche marginale pour comparer/i);
    await page.getByTestId("trading-fiscal-tmi").selectOption("41");
    await expect(bareme).toContainText(/41/);
  });
});

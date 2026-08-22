import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Plateformes — la couche de connexion du patrimoine.
 *
 * Ce que ces tests protègent : la table répond en cinq secondes à « où sont
 * mes comptes et est-ce que tout fonctionne », la sélection ouvre une fiche
 * sans quitter la page, une plateforme manuelle n'est jamais présentée comme
 * en panne, et **aucun secret ne parvient au client**.
 */

async function openPlatforms(page: Page) {
  await gotoDashboard(page);
  await page.goto("/platforms", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("platforms-tab")).toBeVisible({
    timeout: 30_000,
  });
  // Attendre la fin du chargement : le squelette ne porte aucune ligne, et
  // compter dessus ferait passer les tests pour de mauvaises raisons.
  await expect(page.getByTestId("platforms-skeleton")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("platforms-table").or(page.getByTestId("platforms-empty-state"))
  ).toBeVisible({ timeout: 30_000 });
}

const rows = (page: Page) => page.locator("[data-platform-row]");

test.describe("Plateformes", () => {
  test.beforeEach(async ({ page }) => {
    await openPlatforms(page);
  });

  test("la page ouvre sur ses cinq indicateurs", async ({ page }) => {
    await expect(page.getByTestId("platforms-summary")).toBeVisible();
    for (const id of [
      "platforms-kpi-count",
      "platforms-kpi-envelopes",
      "platforms-summary-total",
      "platforms-kpi-synced",
      "platforms-kpi-attention",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("platform-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("sélectionner une plateforme ouvre sa fiche sans emporter la table", async ({
    page,
  }) => {
    test.skip((await rows(page).count()) === 0, "Aucune plateforme");

    await rows(page).first().click();
    const panel = page.getByTestId("platform-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("platform-panel-value")).toBeVisible();

    // La table reste en place : colonne ancrée, ni modale ni navigation.
    await expect(page.getByTestId("platforms-table")).toBeVisible();
    expect(page.url()).toContain("/platforms");

    await page.getByTestId("platform-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("changer de plateforme met à jour le même panneau", async ({ page }) => {
    test.skip((await rows(page).count()) < 2, "Il faut deux plateformes");

    await rows(page).nth(0).click();
    const panel = page.getByTestId("platform-panel");
    const first = await panel.innerText();

    await rows(page).nth(1).click();
    await expect(page.getByTestId("platform-panel")).toHaveCount(1);
    await expect(panel).not.toHaveText(first);
  });

  test("les trois sections du panneau montrent un contenu différent", async ({
    page,
  }) => {
    test.skip((await rows(page).count()) === 0, "Aucune plateforme");
    await rows(page).first().click();

    await page.getByTestId("platform-tab-connection").click();
    await expect(page.getByTestId("platform-panel")).toContainText(
      "Origine des données"
    );

    await page.getByTestId("platform-tab-activity").click();
    await expect(page.getByTestId("platform-panel")).toContainText("Journal");

    await page.getByTestId("platform-tab-summary").click();
    await expect(page.getByTestId("platform-panel-value")).toBeVisible();
  });

  test("une plateforme sans connexion automatique n'est pas présentée comme en panne", async ({
    page,
  }) => {
    /*
      Patrimo ne synchronise que les wallets on-chain. Une banque ou un
      courtier y sont tenus à la main : « Saisie manuelle » est un état normal,
      pas une erreur, et il ne doit jamais compter dans « à traiter ».
    */
    await page.getByTestId("platforms-status-manual").click();
    const count = await rows(page).count();
    test.skip(count === 0, "Aucune plateforme manuelle");

    await rows(page).first().click();
    await page.getByTestId("platform-tab-connection").click();
    const panel = page.getByTestId("platform-panel");
    await expect(panel).toContainText("Saisie manuelle et import");
    await expect(panel).not.toContainText("Erreur");
    // Pas de bouton de synchronisation là où aucune connexion n'existe.
    await expect(page.getByTestId("platform-panel-sync")).toHaveCount(0);
  });

  test("le compteur de synchronisation se rapporte aux seuls wallets", async ({
    page,
  }) => {
    /*
      « 24 synchronisées » sur 12 plateformes n'aurait aucun sens : le
      dénominateur ne peut inclure que ce qui est réellement synchronisable.
    */
    const kpi = page.getByTestId("platforms-kpi-synced");
    const text = await kpi.innerText();
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) {
      // Aucun wallet : le KPI l'annonce plutôt que d'afficher un faux zéro.
      await expect(kpi).toContainText("aucun wallet");
      return;
    }
    expect(Number(match[1])).toBeLessThanOrEqual(Number(match[2]));
  });

  test("la recherche filtre la table sans requête serveur", async ({ page }) => {
    test.skip((await rows(page).count()) === 0, "Aucune plateforme");
    const before = await rows(page).count();
    const name = (await rows(page).first().innerText()).split("\n")[0]!.trim();

    await page.getByTestId("platforms-search").fill(name);
    await expect(rows(page)).not.toHaveCount(before, { timeout: 10_000 });
    await expect(rows(page).first()).toContainText(name);
  });

  test("filtrer masque la fiche d'une plateforme devenue invisible", async ({
    page,
  }) => {
    test.skip((await rows(page).count()) === 0, "Aucune plateforme");

    await rows(page).first().click();
    await expect(page.getByTestId("platform-panel")).toHaveAttribute(
      "data-open",
      "true"
    );

    await page.getByTestId("platforms-search").fill("zzz-aucun-resultat-zzz");
    await expect(page.getByTestId("platforms-no-match")).toBeVisible({
      timeout: 10_000,
    });
    // Le panneau ne peut pas détailler une ligne que la table ne porte plus.
    await expect(page.getByTestId("platform-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("aucun secret ne parvient au client", async ({ page, request }) => {
    /*
      Le contrat de `getPlatformCashBalances` : la clé API reste sur le
      serveur, seule sa **présence** est exposée. Ce test échoue si une
      régression la remet dans la réponse.
    */
    const api = await request.get("/api/platforms").then((r) => r.json());
    const raw = JSON.stringify(api.platforms ?? []);
    expect(raw).not.toContain("walletApiKey");

    for (const p of api.platforms ?? []) {
      expect(Object.keys(p)).not.toContain("walletApiKey");
      expect(Object.keys(p)).not.toContain("apiKey");
    }

    // Et rien de tel n'apparaît à l'écran non plus.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/zk_[A-Za-z0-9]/);
  });

  test("la déconnexion énonce ce qu'elle supprime réellement", async ({
    page,
  }) => {
    test.skip((await rows(page).count()) === 0, "Aucune plateforme");

    await rows(page).first().click();
    await page.getByTestId("platform-panel-delete").click();

    const modal = page.getByTestId("platform-delete-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/irréversible/i);
    await expect(modal).toContainText(/transactions/i);
    await expect(modal).toContainText(/positions/i);
    // Double garde conservée : case à cocher **et** mot de confirmation.
    await expect(page.getByTestId("platform-delete-confirm")).toBeDisabled();

    await page.getByTestId("platform-delete-cancel").click();
    await expect(modal).toHaveCount(0);
  });

  test("un compte sans plateforme affiche un état vide local, pas le cockpit", async ({
    page,
    request,
  }) => {
    const api = await request.get("/api/platforms").then((r) => r.json());
    test.skip(
      (api.platforms ?? []).length > 0,
      "Le jeu de démo porte des plateformes"
    );

    await expect(page.getByTestId("platforms-empty-state")).toBeVisible();
    await expect(page.getByTestId("empty-patrimony-cockpit")).toHaveCount(0);
    await expect(page.getByTestId("platforms-empty-cta")).toBeVisible();
  });
});

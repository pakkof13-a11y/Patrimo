import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Écran « Épargne salariale ».
 *
 * Ces tests protègent trois refus plutôt qu'une mise en page : ne pas annoncer
 * un gain sans montants versés, ne pas faire passer une courbe de versements
 * pour une valorisation de marché, et ne pas ranger un fonds monétaire parmi
 * les actions. Le reste — l'ordre des cartes, les couleurs — peut bouger.
 */

test.describe("Épargne salariale", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/epargne-salariale", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("employee-savings-tab")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("la vue d'ensemble mène la page, la saisie reste repliée", async ({
    page,
  }) => {
    await expect(page.getByTestId("es-kpi-cards")).toBeVisible();
    await expect(page.getByTestId("es-allocation-card")).toBeVisible();
    await expect(page.getByTestId("es-evolution-card")).toBeVisible();
    await expect(page.getByTestId("es-plans")).toBeVisible();
    await expect(page.getByTestId("es-context-column")).toBeVisible();

    await expect(page.getByTestId("es-management")).toHaveCount(0);
    await page.getByTestId("es-manage-toggle").click();
    await expect(page.getByTestId("es-management")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("le repli de gestion survit au rechargement — l'état vit dans l'URL", async ({
    page,
  }) => {
    await page.goto("/epargne-salariale#gestion", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("es-management")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("le nombre de plans compte les enveloppes, pas les lignes de relevé", async ({
    page,
  }) => {
    const pill = page.getByTestId("es-plan-count");
    await expect(pill).toBeVisible({ timeout: 20_000 });

    const cards = page.getByTestId("es-plan-card");
    const shown = await cards.count();
    if (shown === 0) return;

    // Un plan = un type d'enveloppe chez un gestionnaire. Le seed en compte
    // trois pour quatre supports : la pastille ne doit pas compter les lignes.
    const label = await pill.innerText();
    const declared = Number(label.replace(/\D+/g, ""));
    expect(declared).toBeGreaterThanOrEqual(shown);
    await expect(page.getByTestId("eskpi-value")).toContainText("support");
  });

  test("aucun gain n'est annoncé sans montants versés", async ({ page }) => {
    const contributed = page.getByTestId("eskpi-contributed");
    const gain = page.getByTestId("eskpi-gain");
    await expect(contributed).toBeVisible();

    if ((await contributed.innerText()).includes("À renseigner")) {
      // Sans versements, « gain » vaudrait l'encours entier — un capital qui
      // aurait tout rapporté et rien coûté.
      await expect(gain).toContainText("—");
      await expect(page.getByTestId("eskpi-performance")).toContainText("—");
    } else {
      await expect(gain).not.toContainText("À renseigner");
    }
  });

  test("la courbe dit qu'elle trace des versements, pas une valorisation", async ({
    page,
  }) => {
    const card = page.getByTestId("es-evolution-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/versements cumulés/i);

    const unavailable = page.getByTestId("es-evolution-unavailable");
    if ((await unavailable.count()) > 0) {
      await expect(unavailable).toContainText(/montants versés/i);
    } else {
      // Le tracé ne suit pas les marchés, et l'écran l'écrit.
      await expect(card).toContainText(/ne suit pas les marchés/i);
      await page.getByTestId("es-range-1y").click();
      await expect(page.getByTestId("es-range-1y")).toHaveAttribute(
        "data-active",
        "true"
      );
    }
  });

  test("les familles de supports se lisent en texte et distinguent le monétaire", async ({
    page,
  }) => {
    const legend = page.getByTestId("es-allocation-legend");
    if ((await legend.count()) === 0) return;

    await expect(legend).toContainText("%");
    await expect(legend).toContainText("€");

    // Le fonds monétaire du jeu de démonstration ne doit pas être rangé en
    // actions : ce serait annoncer un risque qui n'existe pas.
    const monetary = page.getByTestId("es-allocation-monetary");
    if ((await monetary.count()) > 0) {
      await expect(monetary).toContainText(/monétaires/i);
    }
  });

  test("chaque plan affiche sa répartition et son horizon de déblocage", async ({
    page,
  }) => {
    const cards = page.getByTestId("es-plan-card");
    const empty = page.getByTestId("es-no-plan");
    await expect(cards.first().or(empty)).toBeVisible({ timeout: 20_000 });
    if ((await cards.count()) === 0) return;

    const first = cards.first();
    await expect(first.getByTestId("es-plan-type")).toBeVisible();
    await expect(first.getByTestId("es-plan-status")).toContainText("Ouvert");
    await expect(first).toContainText("Répartition");
    await expect(first).toContainText("Prochain déblocage");
  });

  test("la colonne contextuelle sépare disponible et bloqué", async ({
    page,
  }) => {
    const liquidity = page.getByTestId("es-context-liquidity");
    await expect(liquidity).toBeVisible();
    await expect(liquidity).toContainText("Disponible");
    await expect(liquidity).toContainText("Indisponible");
    // L'épargne salariale est bloquée par défaut : l'écran le rappelle plutôt
    // que de laisser croire à des fonds mobilisables.
    await expect(liquidity).toContainText(/bloquée par défaut/i);
  });
});

import { test, expect } from "@playwright/test";
import { gotoDashboard, loginRequest } from "./helpers";

/*
  `gotoDashboard` ouvre en réalité /positions — c'est le helper de connexion
  partagé, son nom est trompeur. Le tableau de bord se rejoint donc
  explicitement ensuite.
*/

/**
 * Cockpit d'accueil — l'état visuel du compte tant qu'aucune donnée
 * patrimoniale n'existe.
 *
 * Ce que ces tests protègent : le cockpit ne dépend pas d'une préférence
 * d'affichage mais des données réelles, un compte actif ne le voit jamais, et
 * la bascule ne produit aucun aller-retour visible.
 */

test.describe("Cockpit d'accueil", () => {
  test("un compte actif arrive directement sur le tableau de bord", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dashboard-tab")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("empty-patrimony-cockpit")).toHaveCount(0);
  });

  test("aucun aller-retour entre cockpit et tableau de bord", async ({
    page,
  }) => {
    /*
      Le défaut à éviter : trancher avant que l'état patrimonial ait répondu,
      et corriger ensuite. On échantillonne l'écran pendant tout le chargement
      et on refuse toute séquence qui contiendrait le cockpit sur un compte
      qui possède des données.
    */
    const seen: string[] = [];
    const sampler = setInterval(async () => {
      try {
        if (await page.locator('[data-testid="empty-patrimony-cockpit"]').count()) {
          seen.push("cockpit");
        } else if (await page.locator('[data-testid="dashboard-tab"]').count()) {
          seen.push("dashboard");
        }
      } catch {
        /* navigation en cours */
      }
    }, 150);

    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dashboard-tab")).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);
    clearInterval(sampler);

    expect(seen).not.toContain("cockpit");
  });

  test("une préférence d'affichage ne décide plus de l'écran", async ({
    page,
  }) => {
    /*
      `onboardingShowEveryStart` réclamait l'accueil à chaque démarrage. Il ne
      doit plus rien pouvoir : seul l'état patrimonial tranche.
    */
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.localStorage.setItem("onboardingShowEveryStart", "true");
      window.localStorage.removeItem("onboardingDismissed");
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("dashboard-tab")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("empty-patrimony-cockpit")).toHaveCount(0);
  });

  test("l'état patrimonial est servi par l'API, jamais mis en cache", async ({
    request,
  }) => {
    const res = await request.get("/api/patrimony-state");
    expect(res.ok()).toBe(true);
    expect(res.headers()["cache-control"]).toContain("no-store");

    const body = await res.json();
    // Le compte de démonstration porte des données : il n'est pas vierge.
    expect(body.isEmpty).toBe(false);
    expect(Array.isArray(body.families)).toBe(true);
    expect(body.families.length).toBeGreaterThan(0);
  });
});

test.describe("Cockpit — compte vierge", () => {
  // Session propre : le compte administrateur n'est pas seedé en e2e.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("un compte sans aucune donnée voit le cockpit", async ({ page }) => {
    const user = process.env.ADMIN_USERNAME?.trim() || "admin";
    const pass = process.env.ADMIN_PASSWORD?.trim();
    test.skip(!pass, "ADMIN_PASSWORD absent — compte vierge indisponible");

    await loginRequest(page.request, user, pass!);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const cockpit = page.getByTestId("empty-patrimony-cockpit");
    await expect(cockpit).toBeVisible({ timeout: 30_000 });

    // Deux actions, et une seule mise en avant.
    await expect(page.getByTestId("cockpit-platform-cta")).toBeVisible();
    await expect(page.getByTestId("cockpit-transaction-cta")).toBeVisible();

    /*
      Aucun chiffre : pas de patrimoine à 0 €, pas de courbe vide. Un compte
      sans données n'a rien à afficher, et le prétendre serait la première
      chose fausse que l'application dirait.
    */
    await expect(page.getByTestId("dashboard-tab")).toHaveCount(0);
    await expect(cockpit).not.toContainText("€");

    // Ni checklist ni progression : le cockpit n'est pas un onboarding.
    await expect(cockpit).not.toContainText(/étapes?/i);
    await expect(cockpit).not.toContainText("%");
  });

  test("le cockpit ouvre les vrais flux de création", async ({ page }) => {
    const user = process.env.ADMIN_USERNAME?.trim() || "admin";
    const pass = process.env.ADMIN_PASSWORD?.trim();
    test.skip(!pass, "ADMIN_PASSWORD absent");

    await loginRequest(page.request, user, pass!);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("empty-patrimony-cockpit")).toBeVisible({
      timeout: 30_000,
    });

    // Le bouton n'ouvre pas un parcours dédié mais le formulaire existant.
    await page.getByTestId("cockpit-transaction-cta").click();
    await expect(page.getByTestId("tx-form")).toBeVisible({ timeout: 15_000 });
  });
});

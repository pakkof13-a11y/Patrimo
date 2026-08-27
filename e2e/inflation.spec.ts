import { test, expect, type Page } from "@playwright/test";

/**
 * Comparaison « Portefeuille / Inflation ».
 *
 * Avant ce chantier, la courbe reposait sur une constante de 2 % l'an appliquée
 * au prorata du temps : elle s'affichait toujours, y compris sur sept jours, et
 * ne décrivait aucun IPC. Elle repose désormais sur des observations mensuelles
 * réelles — et disparaît quand elles manquent.
 *
 * Les séries utilisées ici sont interceptées : ce sont des observations de
 * test, jamais des données INSEE.
 */

const PANNEAU = '[data-testid="evolution-chart"]';

async function ouvrir(page: Page, range: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(PANNEAU)).toBeVisible({ timeout: 40_000 });
  await page.getByTestId(`evolution-range-${range}`).click();
}

test.describe("Inflation — disponibilité", () => {
  test("1 — sur 7 J, la comparaison n'est pas proposée", async ({ page }) => {
    /*
      L'IPC est publié une fois par mois : sur sept jours il n'y a au mieux
      qu'une publication dans la fenêtre, donc aucune variation à montrer.
    */
    await ouvrir(page, "7d");
    const choix = page.getByTestId("evolution-versus-inflation");
    await expect(choix).toBeVisible();
    await expect(choix).toBeDisabled();
  });

  test("à partir de 1 M, la comparaison redevient disponible", async ({ page }) => {
    await ouvrir(page, "1m");
    await expect(page.getByTestId("evolution-versus-inflation")).toBeEnabled();
  });

  test("11 et 12 — sans observation, l'absence est nommée", async ({ page }) => {
    /*
      Le comportement à ne jamais reprendre : tracer une ligne plausible. Une
      courbe à zéro affirmerait une inflation nulle, ce qui est une mesure.
    */
    await page.route("**/api/macro/cpi**", (route) =>
      route.fulfill({ json: { available: false, reason: "no-data", days: 180 } })
    );
    await ouvrir(page, "6m");
    await page.getByTestId("evolution-versus-inflation").click();

    const note = page.getByTestId("evolution-inflation-unavailable");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText("Inflation indisponible");
    await expect(note).toContainText("aucune observation");
  });

  test("10 — un mois manquant est dit comme tel", async ({ page }) => {
    await page.route("**/api/macro/cpi**", (route) =>
      route.fulfill({ json: { available: false, reason: "incomplete", days: 180 } })
    );
    await ouvrir(page, "6m");
    await page.getByTestId("evolution-versus-inflation").click();
    await expect(page.getByTestId("evolution-inflation-unavailable")).toContainText(
      "un mois manque"
    );
  });

  test("avec des observations, la courbe est tracée et l'écart annoncé", async ({
    page,
  }) => {
    await page.route("**/api/macro/cpi**", (route) =>
      route.fulfill({
        json: {
          available: true,
          source: "TEST",
          days: 180,
          points: [
            { period: "2026-03", cumulative: 0, monthlyRate: 0.002 },
            { period: "2026-04", cumulative: 0.003, monthlyRate: 0.003 },
            { period: "2026-05", cumulative: 0.005, monthlyRate: 0.002 },
            { period: "2026-06", cumulative: 0.004, monthlyRate: -0.001 },
            { period: "2026-07", cumulative: 0.009, monthlyRate: 0.005 },
            { period: "2026-08", cumulative: 0.011, monthlyRate: 0.002 },
          ],
        },
      })
    );
    await ouvrir(page, "6m");
    await page.getByTestId("evolution-versus-inflation").click();

    // L'indisponibilité ne doit pas s'afficher, et la note de comparaison si.
    await expect(page.getByTestId("evolution-inflation-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("evolution-vs-note")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("evolution-vs-note")).toContainText("Inflation");
  });

  test("19 — aucun institut statistique n'est joint depuis le navigateur", async ({
    page,
  }) => {
    const externes: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (/insee|eurostat|bdm/i.test(url)) externes.push(url);
      return route.continue();
    });
    await ouvrir(page, "1y");
    await page.getByTestId("evolution-versus-inflation").click();
    await page.waitForTimeout(1500);
    expect(externes).toEqual([]);
  });

  test("20 — basculer la comparaison ne change pas la courbe du portefeuille", async ({
    page,
  }) => {
    await ouvrir(page, "1y");
    const avant = await page.getByTestId("evolution-headline").innerText().catch(() => "");

    await page.getByTestId("evolution-versus-inflation").click();
    await page.waitForTimeout(800);
    await page.getByTestId("evolution-versus-none").click();
    await page.waitForTimeout(800);

    const apres = await page.getByTestId("evolution-headline").innerText().catch(() => "");
    expect(apres).toBe(avant);
  });

  test("courbe inflation : trait plein, teinte du design system", async ({
    page,
  }) => {
    await page.route("**/api/macro/cpi**", (route) =>
      route.fulfill({
        json: {
          available: true,
          source: "TEST",
          days: 180,
          points: [
            { period: "2026-03", cumulative: 0, monthlyRate: 0.002 },
            { period: "2026-04", cumulative: 0.003, monthlyRate: 0.003 },
            { period: "2026-05", cumulative: 0.005, monthlyRate: 0.002 },
          ],
        },
      })
    );
    await ouvrir(page, "6m");
    await page.getByTestId("evolution-versus-inflation").click();
    await expect(page.getByTestId("evolution-vs-note")).toBeVisible({
      timeout: 20_000,
    });

    const line = page.locator(".recharts-line-curve").last();
    await expect(line).toBeVisible();
    const dash = await line.getAttribute("stroke-dasharray");
    expect(dash === null || dash === "" || dash === "none").toBe(true);
    const stroke = await line.getAttribute("stroke");
    expect(stroke ?? "").toContain("chart-inflation");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`21-22 — jeton inflation en ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((mode) => {
        document.documentElement.classList.toggle("dark", mode === "dark");
      }, scheme);
      await page.route("**/api/macro/cpi**", (route) =>
        route.fulfill({
          json: {
            available: true,
            source: "TEST",
            days: 90,
            points: [
              { period: "2026-03", cumulative: 0, monthlyRate: 0 },
              { period: "2026-04", cumulative: 0.002, monthlyRate: 0.002 },
            ],
          },
        })
      );
      await ouvrir(page, "3m");
      await page.getByTestId("evolution-versus-inflation").click();
      const line = page.locator(".recharts-line-curve").last();
      await expect(line).toBeVisible({ timeout: 20_000 });
      expect(await line.getAttribute("stroke")).toContain("chart-inflation");
    });
  }
});

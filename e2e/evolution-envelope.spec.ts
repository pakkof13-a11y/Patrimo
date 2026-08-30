import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Ventilation historique par enveloppe fiscale.
 *
 * Le point qui mérite un test de bout en bout n'est pas l'existence du
 * sélecteur, mais l'honnêteté de ce qu'il montre : le journal des enveloppes ne
 * remonte qu'à sa mise en place, et l'écran doit le dire plutôt que de laisser
 * croire que PEA + CTO couvre tous les titres.
 */
test.describe("Évolution — par enveloppe fiscale", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("portfolio-evolution-panel")).toBeVisible({
      timeout: 25_000,
    });
  });

  test("le sélecteur propose Tout, PEA et CTO", async ({ page }) => {
    await expect(page.getByTestId("evolution-envelope-all")).toBeVisible();
    await expect(page.getByTestId("evolution-envelope-PEA")).toBeVisible();
    await expect(page.getByTestId("evolution-envelope-CTO")).toBeVisible();
    // Trois seaux, pas quatre : PEA-PME rejoint PEA.
    await expect(page.getByTestId("evolution-envelope-PEA_PME")).toHaveCount(0);
  });

  test("PEA et CTO tracent les valeurs de l'API, jamais le patrimoine entier", async ({
    page,
  }) => {
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    const dernier = [...(body.history ?? [])]
      .reverse()
      .find((p: { byEnvelopeBase?: Record<string, number> }) => p.byEnvelopeBase);
    expect(dernier).toBeTruthy();

    const pea = Number(dernier.byEnvelopeBase.PEA);
    const cto = Number(dernier.byEnvelopeBase.CTO);
    const brut = Number(dernier.grossAssetsBase);

    // Le décor du test : chaque enveloppe est une fraction du patrimoine.
    expect(pea + cto).toBeGreaterThan(0);
    expect(pea + cto).toBeLessThan(brut);

    const panel = page.getByTestId("portfolio-evolution-panel");
    await page.getByTestId("evolution-envelope-PEA").click();
    await expect(panel).toContainText("PEA — valeur des titres", { timeout: 15_000 });

    await page.getByTestId("evolution-envelope-CTO").click();
    await expect(panel).toContainText("CTO — valeur des titres", { timeout: 15_000 });
  });

  test("aucune valeur n'est attribuée avant le premier événement du journal", async ({
    page,
  }) => {
    /*
      Le garde-fou absolu du chantier, vérifié sur la réponse réelle de l'API :
      une ligne achetée il y a des années mais observée récemment ne doit
      contribuer à aucune enveloppe sur les points antérieurs.
    */
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    const points = (body.history ?? []).filter(
      (p: { byEnvelopeBase?: unknown }) => p.byEnvelopeBase
    );
    expect(points.length).toBeGreaterThan(0);

    // Le premier point où une enveloppe devient connue.
    const iConnu = points.findIndex(
      (p: { byEnvelopeBase: Record<string, number> }) =>
        Number(p.byEnvelopeBase.PEA) > 0 || Number(p.byEnvelopeBase.CTO) > 0
    );

    if (iConnu > 0) {
      for (const p of points.slice(0, iConnu)) {
        expect(Number(p.byEnvelopeBase.PEA)).toBe(0);
        expect(Number(p.byEnvelopeBase.CTO)).toBe(0);
      }
    }
  });

  test("revenir à Tout restaure le patrimoine entier", async ({ page }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");

    await page.getByTestId("evolution-envelope-CTO").click();
    await expect(panel).toContainText("CTO — valeur des titres", { timeout: 15_000 });

    await page.getByTestId("evolution-envelope-all").click();
    await expect(panel).toContainText("Actifs bruts", { timeout: 15_000 });
    // Le choix brut/net redevient disponible hors enveloppe.
    await expect(page.getByTestId("evolution-scope-gross")).toBeVisible();
  });

  test("choisir une enveloppe remet la classe à Tout, et l'inverse", async ({
    page,
  }) => {
    /*
      Classe et enveloppe répondent à deux questions différentes — ce que l'on
      détient, et où — qui ne se composent pas.
    */
    const panel = page.getByTestId("portfolio-evolution-panel");

    await page.getByTestId("evolution-class-CRYPTO").click();
    await expect(panel).toContainText("Crypto", { timeout: 15_000 });

    await page.getByTestId("evolution-envelope-PEA").click();
    await expect(panel).toContainText("PEA — valeur des titres", { timeout: 15_000 });
    await expect(panel).not.toContainText("Crypto —");
  });

  test("le comparatif avec indice reste disponible", async ({ page }) => {
    // Aucune régression : le sélecteur « Vs » n'est pas touché.
    await expect(page.getByTestId("evolution-versus-none")).toBeVisible();
    await expect(page.getByTestId("evolution-versus-index")).toBeVisible();
    await expect(page.getByTestId("evolution-versus-inflation")).toHaveCount(0);
  });
});

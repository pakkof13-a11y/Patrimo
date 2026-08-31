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

  test("avant le premier événement, l'API expose une absence et non un zéro", async ({
    page,
  }) => {
    /*
      Le garde-fou absolu du chantier, vérifié sur la réponse réelle de l'API.

      Ce test exigeait auparavant exactement `0` sur ces points. Il entérinait
      donc le défaut qu'il prétendait garder : un zéro se trace, et une courbe
      plate à zéro sur cinq ans affirme « aucun titre en PEA » là où la vérité
      est « on ne sait pas ». La protection ne disparaît pas, elle se durcit —
      on exige désormais l'absence, et l'on vérifie en plus que la valeur n'a
      pas été perdue en route.
    */
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    type Point = { byEnvelopeBase?: Record<string, number | null> };
    const points: Point[] = (body.history ?? []).filter(
      (p: Point) => p.byEnvelopeBase
    );
    expect(points.length).toBeGreaterThan(0);

    // Le premier point où une enveloppe devient réellement démontrée.
    const iConnu = points.findIndex(
      (p) =>
        Number(p.byEnvelopeBase!.PEA ?? 0) > 0 ||
        Number(p.byEnvelopeBase!.CTO ?? 0) > 0
    );
    /*
      Sans point connu, le test ne vérifierait rien : la garde `if` qui
      encadrait la boucle le rendait silencieusement vide. On exige donc que le
      décor existe.
    */
    expect(iConnu).toBeGreaterThan(0);

    const avant = points.slice(0, iConnu);
    const inconnus = avant.filter(
      (p) => Number(p.byEnvelopeBase!.UNKNOWN ?? 0) > 0
    );
    // Le compte de démonstration porte bien des titres avant son journal.
    expect(inconnus.length).toBeGreaterThan(0);

    for (const p of inconnus) {
      // Absence, pas zéro : le point ne doit pas être traçable.
      expect(p.byEnvelopeBase!.PEA).toBeNull();
      expect(p.byEnvelopeBase!.CTO).toBeNull();
    }

    // Et aucun point antérieur n'attribue de valeur à une enveloppe.
    for (const p of avant) {
      expect(Number(p.byEnvelopeBase!.PEA ?? 0)).toBe(0);
      expect(Number(p.byEnvelopeBase!.CTO ?? 0)).toBe(0);
    }

    // Après l'événement, la bonne enveloppe reçoit la valeur.
    const apres = points[points.length - 1]!;
    const pea = Number(apres.byEnvelopeBase!.PEA ?? 0);
    const cto = Number(apres.byEnvelopeBase!.CTO ?? 0);
    expect(pea + cto).toBeGreaterThan(0);
  });

  test("l'avertissement couvre la fenêtre, pas seulement son dernier point", async ({
    page,
  }) => {
    /*
      Le cas qui rendait l'avertissement inopérant : toutes les lignes sont
      observées aujourd'hui, donc le dernier point ne porte aucun inconnu — et
      la mention disparaissait, alors même que les années précédentes de la
      courbe restaient entièrement inconnues.
    */
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    type Point = { byEnvelopeBase?: Record<string, number | null> };
    const points: Point[] = (body.history ?? []).filter(
      (p: Point) => p.byEnvelopeBase
    );
    const dernier = points[points.length - 1]!;
    // Le décor : le présent est connu…
    expect(Number(dernier.byEnvelopeBase!.UNKNOWN ?? 0)).toBe(0);
    // …et le passé ne l'est pas.
    expect(
      points.some((p) => Number(p.byEnvelopeBase!.UNKNOWN ?? 0) > 0)
    ).toBe(true);

    await page.getByTestId("evolution-envelope-PEA").click();
    const note = page.getByTestId("evolution-envelope-unknown");
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText(/inconnue avant le premier constat/i);
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

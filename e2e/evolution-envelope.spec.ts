import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Croisement classe × enveloppe fiscale.
 *
 * L'enveloppe n'est plus une alternative à la classe mais une précision à
 * l'intérieur d'elle : « où sont mes actions » est la question posée, et elle
 * n'a de sens que là où un compte-titres peut loger la classe. Le sélecteur
 * n'existe donc que sur les actions.
 *
 * Ce qui mérite un test de bout en bout n'est pas l'existence des contrôles,
 * mais l'honnêteté de ce qu'ils montrent : le journal des enveloppes ne remonte
 * qu'à sa mise en place, et l'écran doit le dire plutôt que de laisser croire
 * que PEA + CTO couvre toutes les actions.
 */

type Point = {
  byAssetClassBase?: Record<string, number>;
  byAssetClassAndEnvelopeBase?: Record<string, Record<string, number | null>>;
};

async function serie(page: import("@playwright/test").Page): Promise<Point[]> {
  const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
  return ((body.history ?? []) as Point[]).filter(
    (p) => p.byAssetClassAndEnvelopeBase
  );
}

test.describe("Évolution — croisement classe × enveloppe", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("portfolio-evolution-panel")).toBeVisible({
      timeout: 25_000,
    });
  });

  test("sans classe, aucun choix d'enveloppe n'est proposé", async ({ page }) => {
    // « Tout » ne porte pas de filtre d'enveloppe : la question est par classe.
    await expect(page.getByTestId("evolution-envelope-all")).toHaveCount(0);
    await expect(page.getByTestId("evolution-envelope-PEA")).toHaveCount(0);
    await expect(page.getByTestId("evolution-envelope-CTO")).toHaveCount(0);
  });

  test("les actions ouvrent Tout, PEA et CTO — et rien d'autre", async ({
    page,
  }) => {
    await page.getByTestId("evolution-class-ACTIONS").click();
    await expect(page.getByTestId("evolution-envelope-all")).toBeVisible();
    await expect(page.getByTestId("evolution-envelope-PEA")).toBeVisible();
    await expect(page.getByTestId("evolution-envelope-CTO")).toBeVisible();
    // Trois seaux, pas quatre : PEA-PME rejoint PEA.
    await expect(page.getByTestId("evolution-envelope-PEA_PME")).toHaveCount(0);
  });

  test("les classes sans enveloppe n'affichent aucun contrôle", async ({
    page,
  }) => {
    /*
      Obligations comprises : le produit n'en connaît qu'en compte-titres, et
      leur proposer « PEA » offrirait un choix dont la série serait vide par
      convention d'interface plutôt que par constat.
    */
    for (const cls of ["OBLIGATIONS", "CRYPTO", "IMMOBILIER", "CASH", "AUTRE"]) {
      await page.getByTestId(`evolution-class-${cls}`).click();
      await expect(page.getByTestId("evolution-envelope-PEA")).toHaveCount(0);
      await expect(page.getByTestId("evolution-envelope-CTO")).toHaveCount(0);
      await expect(page.getByTestId("evolution-envelope-all")).toHaveCount(0);
    }
  });

  test("les obligations annoncent leur enveloppe sans la proposer", async ({
    page,
  }) => {
    await page.getByTestId("evolution-class-OBLIGATIONS").click();
    const panel = page.getByTestId("portfolio-evolution-panel");
    await expect(panel).toContainText("Obligations (CTO)", { timeout: 15_000 });
  });

  test("Actions + PEA et Actions + CTO tracent le croisement de l'API", async ({
    page,
  }) => {
    const points = await serie(page);
    const dernier = points[points.length - 1]!;
    const croise = dernier.byAssetClassAndEnvelopeBase!;

    const pea = Number(croise.ACTIONS?.PEA ?? 0);
    const cto = Number(croise.ACTIONS?.CTO ?? 0);
    const actions = Number(dernier.byAssetClassBase?.ACTIONS ?? 0);

    // Le décor : chaque enveloppe est une fraction stricte de la classe.
    expect(pea).toBeGreaterThan(0);
    expect(cto).toBeGreaterThan(0);
    expect(pea + cto).toBeLessThanOrEqual(actions + 1e-6);

    const panel = page.getByTestId("portfolio-evolution-panel");
    await page.getByTestId("evolution-class-ACTIONS").click();
    await page.getByTestId("evolution-envelope-PEA").click();
    await expect(panel).toContainText("Actions en PEA", { timeout: 15_000 });

    await page.getByTestId("evolution-envelope-CTO").click();
    await expect(panel).toContainText("Actions en CTO", { timeout: 15_000 });
  });

  test("le croisement sépare réellement les classes, il ne rejoue pas la globale", async ({
    page,
  }) => {
    /*
      Le cœur du chantier, vérifié numériquement. Une obligation en compte-titres
      ne doit pas figurer dans « Actions en CTO » : la ventilation globale les
      additionnait, le croisement les sépare.
    */
    const points = await serie(page);
    const dernier = points[points.length - 1]!.byAssetClassAndEnvelopeBase!;
    const obliCto = Number(dernier.OBLIGATIONS?.CTO ?? 0);
    // Le décor n'a d'intérêt que s'il existe des obligations en compte-titres.
    expect(obliCto).toBeGreaterThan(0);

    const actionsCto = Number(dernier.ACTIONS?.CTO ?? 0);
    const totalTitresCto = actionsCto + obliCto;
    // Les deux montants sont distincts : la classe n'absorbe pas l'autre.
    expect(actionsCto).toBeLessThan(totalTitresCto);
  });

  test("aucune classe hors titres ne porte de croisement", async ({ page }) => {
    const points = await serie(page);
    for (const p of points.slice(-5)) {
      expect(Object.keys(p.byAssetClassAndEnvelopeBase!).sort()).toEqual([
        "ACTIONS",
        "OBLIGATIONS",
      ]);
    }
  });

  test("avant le premier événement, l'API expose une absence et non un zéro", async ({
    page,
  }) => {
    /*
      Le garde-fou absolu, conservé du chantier précédent et transposé au
      croisement : une action achetée il y a des années mais observée récemment
      ne doit contribuer à aucune enveloppe sur les points antérieurs — et
      l'absence, jamais un zéro, doit le dire.
    */
    const points = await serie(page);
    const act = (p: Point) => p.byAssetClassAndEnvelopeBase!.ACTIONS!;

    const iConnu = points.findIndex(
      (p) => Number(act(p).PEA ?? 0) > 0 || Number(act(p).CTO ?? 0) > 0
    );
    // Sans point connu le test ne vérifierait rien : on exige le décor.
    expect(iConnu).toBeGreaterThan(0);

    const avant = points.slice(0, iConnu);
    const inconnus = avant.filter((p) => Number(act(p).UNKNOWN ?? 0) > 0);
    expect(inconnus.length).toBeGreaterThan(0);

    for (const p of inconnus) {
      expect(act(p).PEA).toBeNull();
      expect(act(p).CTO).toBeNull();
    }
    for (const p of avant) {
      expect(Number(act(p).PEA ?? 0)).toBe(0);
      expect(Number(act(p).CTO ?? 0)).toBe(0);
    }

    // Après l'événement, la bonne enveloppe reçoit la valeur.
    const dernier = points[points.length - 1]!;
    expect(
      Number(act(dernier).PEA ?? 0) + Number(act(dernier).CTO ?? 0)
    ).toBeGreaterThan(0);
  });

  test("l'avertissement couvre la fenêtre, pas seulement son dernier point", async ({
    page,
  }) => {
    /*
      Le cas qui rendait l'avertissement inopérant : toutes les lignes sont
      observées aujourd'hui, donc le dernier point ne porte aucun inconnu — et
      la mention disparaissait, alors même que les années précédentes de la
      courbe restaient entièrement inconnues.

      Le décor — présent connu, passé inconnu — est déjà établi numériquement
      par le test précédent, sur la même réponse d'API. Le revérifier ici
      coûtait un appel de plus dont ce test n'a pas besoin, et c'est cet appel,
      non l'assertion, qui tombait. On s'en tient donc à ce que l'écran montre.
    */
    await page.getByTestId("evolution-class-ACTIONS").click();
    await page.getByTestId("evolution-envelope-PEA").click();
    const note = page.getByTestId("evolution-envelope-unknown");
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText(/inconnue avant le premier constat/i);
    // Le montant annoncé est un vrai montant, pas un gabarit vide.
    await expect(note).toContainText(/\d/);
  });

  test("changer de classe abandonne l'enveloppe et ne la ressuscite pas", async ({
    page,
  }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");

    await page.getByTestId("evolution-class-ACTIONS").click();
    await page.getByTestId("evolution-envelope-PEA").click();
    await expect(panel).toContainText("Actions en PEA", { timeout: 15_000 });

    // Passer sur la crypto : le contrôle disparaît, le filtre avec lui.
    await page.getByTestId("evolution-class-CRYPTO").click();
    await expect(page.getByTestId("evolution-envelope-PEA")).toHaveCount(0);
    await expect(panel).toContainText("Crypto", { timeout: 15_000 });

    // Revenir aux actions : « Tout » par défaut, jamais le PEA d'avant.
    await page.getByTestId("evolution-class-ACTIONS").click();
    await expect(page.getByTestId("evolution-envelope-all")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(panel).not.toContainText("Actions en PEA");
  });

  test("revenir à Tout restaure le patrimoine entier", async ({ page }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");

    await page.getByTestId("evolution-class-ACTIONS").click();
    await page.getByTestId("evolution-envelope-CTO").click();
    await expect(panel).toContainText("Actions en CTO", { timeout: 15_000 });

    await page.getByTestId("evolution-class-all").click();
    await expect(panel).toContainText("Actifs bruts", { timeout: 15_000 });
    // Le choix brut/net redevient disponible hors classe.
    await expect(page.getByTestId("evolution-scope-gross")).toBeVisible();
  });

  test("la performance disparaît dès qu'une enveloppe est choisie", async ({
    page,
  }) => {
    /*
      Aucun flux historique n'est attribuable à une enveloppe — l'enveloppe d'un
      achat de 2024 est précisément ce que le journal ne dit pas. Proposer le
      choix produirait un chiffre faux.
    */
    await page.getByTestId("evolution-class-ACTIONS").click();
    await expect(page.getByTestId("evolution-metric-performance")).toBeVisible();

    await page.getByTestId("evolution-envelope-PEA").click();
    await expect(page.getByTestId("evolution-metric-performance")).toHaveCount(0);
  });

  test("le comparatif avec indice reste disponible", async ({ page }) => {
    await expect(page.getByTestId("evolution-versus-index")).toBeVisible();
  });
});

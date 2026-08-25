import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Cohérence des totaux : ce que le tableau de bord annonce pour une famille
 * doit être ce que le module de cette famille sait montrer.
 *
 * ## Pourquoi ce test existe
 *
 * L'audit transversal a relevé un trou de couverture précis : sur 189 tests
 * unitaires et 41 specs de bout en bout, aucun ne comparait deux sorties entre
 * elles, et aucune assertion numérique n'existait côté e2e. Les assertions
 * immobilières et assurance-vie sont même écrites tolérantes par construction
 * — « au moins un bien, ou la table vide » — ce qui les rend robustes à l'état
 * de la base et, du même coup, aveugles à une ligne qui manque.
 *
 * Deux divergences réelles ont survécu à ce dispositif :
 *
 * - Immobilier : deux SCPI comptent au patrimoine sans figurer dans aucun
 *   onglet du module, faute de `IndirectRealEstateDetail`.
 * - Assurance-vie : les reliquats de l'ancienne saisie (`cashEuro` et
 *   `LifeInsuranceProduct`) sont ajoutés à l'encours affiché alors qu'ils
 *   n'entrent plus au patrimoine.
 *
 * Ce test ne corrige ni l'une ni l'autre. Il les rend visibles, et empêche
 * qu'une troisième s'installe.
 *
 * ## Ce qu'il compare, et ce qu'il refuse de comparer
 *
 * Une famille n'est retenue que si trois conditions sont réunies : le tableau
 * de bord porte un total pour elle, le module en porte un, et les deux
 * désignent **la même notion**. Comparer deux périmètres différents
 * produirait un échec permanent qui n'apprendrait rien — c'est pourquoi
 * plusieurs familles sont explicitement écartées plus bas, avec leur raison.
 *
 * Une quatrième condition, moins évidente, a écarté les Alternatifs : le
 * tableau de bord et le module y appellent *la même fonction*
 * (`getAlternativesPortfolioSlice`). L'assertion serait tautologique — verte
 * par construction, incapable de détecter quoi que ce soit. Un test qui ne
 * peut pas échouer ne protège de rien.
 */

/** Somme monétaire tolérée entre deux chemins de calcul. */
const TOLERANCE_EUR = 0.01;

/**
 * Un centime, et pas davantage.
 *
 * Les deux côtés partent des mêmes décimales exactes ; ils divergent seulement
 * par leurs arrondis de présentation — le bundle rend huit décimales, les
 * routes de module arrondissent au centime, et les conversions de change
 * s'appliquent ligne à ligne d'un côté, sur le total de l'autre. Au-delà d'un
 * centime, l'écart n'est plus un arrondi : c'est une divergence de périmètre,
 * exactement ce que ce test doit attraper.
 */

type Comparison = {
  family: string;
  dashboard: number;
  module: number;
  /** Ce que le module additionne, pour que l'échec se lise sans le code. */
  moduleSource: string;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const eur = (v: number) =>
  `${v.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;

async function getJson(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * Vérifie une ligne de la matrice.
 *
 * Le message nomme la famille, les deux montants et la source du total module,
 * de sorte qu'un échec futur identifie le module concerné sans lecture de code.
 */
function expectCoherent(c: Comparison) {
  const delta = c.module - c.dashboard;
  expect(
    Math.abs(delta),
    `${c.family} : tableau de bord ${eur(c.dashboard)}, module ${eur(c.module)} ` +
      `(écart ${delta >= 0 ? "+" : ""}${eur(delta)}). ` +
      `Le module additionne ${c.moduleSource}.`
  ).toBeLessThanOrEqual(TOLERANCE_EUR);
}

test.describe("Cohérence tableau de bord ↔ modules", () => {
  test("Immobilier : le module montre ce que le patrimoine compte", async ({
    request,
  }) => {
    const portfolio = await getJson(request, "/api/portfolio");
    const dashboard = num(portfolio.summary?.totalRealEstateEur);

    /*
      Le total du module est reconstitué comme le fait `real-estate-tab.tsx` :
      les biens de l'onglet « Biens » et les véhicules de l'onglet « SCPI &
      sociétés », valorisés par leur position au journal. On ne recalcule
      aucune valeur — on joint les mêmes sources que l'écran, par `assetId`.
    */
    const [props, indirect, bundle] = await Promise.all([
      getJson(request, "/api/real-estate/properties"),
      getJson(request, "/api/real-estate/indirect"),
      // Les positions telles que l'écran les reçoit en propriété `holdings`.
      getJson(request, "/api/holdings"),
    ]);

    const holdingValueByAsset = new Map<string, number>(
      (bundle.holdings ?? []).map((h: { assetId: string; marketValueEur: string }) => [
        h.assetId,
        num(h.marketValueEur),
      ])
    );

    const biens = (props.properties ?? []).reduce(
      (acc: number, p: { assetId: string }) =>
        acc + (holdingValueByAsset.get(p.assetId) ?? 0),
      0
    );
    const vehicules = (indirect.vehicles ?? []).reduce(
      (acc: number, v: { marketValueEur: string }) => acc + num(v.marketValueEur),
      0
    );

    expectCoherent({
      family: "Immobilier",
      dashboard,
      module: biens + vehicules,
      moduleSource: `${(props.properties ?? []).length} bien(s) = ${eur(biens)} et ` +
        `${(indirect.vehicles ?? []).length} véhicule(s) indirect(s) = ${eur(vehicules)}`,
    });
  });

  test("Immobilier : l'en-tête du module annonce le même total que la tuile", async ({
    page,
    request,
  }) => {
    /*
      L'en-tête dit « Vue d'ensemble de votre patrimoine immobilier » et
      affiche une « Valeur totale ». Il ne comptait que les biens détenus en
      direct : 312 000 € face aux 337 240 € de la tuile, sur le même écran.
      Une part de SCPI est de l'immobilier — elle appartient à ce total.
    */
    const bundle = await getJson(request, "/api/holdings");
    const attendu = num(bundle.summary?.totalRealEstateEur);
    expect(attendu).toBeGreaterThan(0);

    await page.goto("/immobilier", { waitUntil: "domcontentloaded" });
    const tuile = page.getByTestId("re-kpi-value");
    await expect(tuile).toBeVisible({ timeout: 30_000 });

    /*
      La valeur vient des positions, qui arrivent après le rendu de la bande :
      la tuile affiche brièvement 0 € avant de se remplir. L'assertion est
      donc réessayée plutôt que lue une fois — un écart réel finit malgré
      tout par échouer, avec les deux montants dans le message.
    */
    // Le montant seul : la ligne secondaire porte elle aussi un nombre, et
    // lire toute la tuile les concaténerait.
    const montant = tuile.locator("p.num").first();
    await expect(async () => {
      const affiche = await montant.innerText();
      const chiffres = Number(
        affiche.replace(/[^0-9,]/g, "").replace(",", ".")
      );
      expect(
        chiffres,
        `En-tête Immobilier « ${affiche.trim()} » contre tuile ${eur(attendu)}.`
      ).toBeCloseTo(attendu, 2);
    }).toPass({ timeout: 30_000 });
  });

  test("Immobilier : une SCPI détenue figure dans le module et dans l'IFI", async ({
    request,
  }) => {
    /*
      Le test précédent compare deux totaux ; celui-ci nomme ce qui manquait.
      Une part de SCPI est de l'immobilier détenu indirectement : elle compte au
      patrimoine par le journal, elle doit se voir dans l'onglet « SCPI &
      sociétés », et elle est imposable à l'IFI comme un bien détenu en direct.
    */
    const [bundle, indirect, tax] = await Promise.all([
      getJson(request, "/api/holdings"),
      getJson(request, "/api/real-estate/indirect"),
      getJson(request, "/api/real-estate/tax"),
    ]);

    const scpiHoldings = (bundle.holdings ?? []).filter(
      (h: { accountType: string; category: string | null }) =>
        h.accountType === "IMMOBILIER" && h.category === "SCPI"
    );

    // Sans SCPI détenue, le scénario n'est pas couvert — on le dit plutôt que
    // de laisser un test vert prouver le vide.
    expect(
      scpiHoldings.length,
      "Aucune position SCPI au portefeuille : ce scénario n'est plus couvert par les données."
    ).toBeGreaterThan(0);

    const vehicules = indirect.vehicles ?? [];
    const parAsset = new Set(vehicules.map((v: { assetId: string }) => v.assetId));

    for (const h of scpiHoldings as Array<{ assetId: string; name: string }>) {
      expect(
        parAsset.has(h.assetId),
        `« ${h.name} » compte au patrimoine immobilier mais n'apparaît dans aucun ` +
          `onglet du module Immobilier : ${vehicules.length} véhicule(s) listé(s).`
      ).toBe(true);
    }

    // Et la même valeur doit peser dans l'assiette IFI.
    const lignesIfi = new Set(
      (tax.ifi?.lines ?? []).map((l: { id: string }) => l.id)
    );
    for (const h of scpiHoldings as Array<{ assetId: string; name: string }>) {
      expect(
        lignesIfi.has(h.assetId),
        `« ${h.name} » est un actif imposable à l'IFI, absent de l'assiette.`
      ).toBe(true);
    }
  });

  test("Assurance-vie : l'encours affiché est celui qui entre au patrimoine", async ({
    request,
  }) => {
    const portfolio = await getJson(request, "/api/portfolio");
    const dashboard = num(portfolio.summary?.totalLifeInsuranceEur);

    // `totalOutstandingEur` est le total que l'écran affiche : supports du
    // journal, plus les reliquats de l'ancienne saisie que l'API y rajoute.
    const av = await getJson(request, "/api/life-insurance");

    expectCoherent({
      family: "Assurance-vie",
      dashboard,
      module: num(av.totalOutstandingEur),
      moduleSource: `l'encours des ${(av.policies ?? []).length} contrat(s)`,
    });
  });

  test("Assurance-vie : les reliquats hérités sont nommés, jamais fondus dans l'encours", async ({
    request,
  }) => {
    /*
      Les anciens champs `cashEuro` et `LifeInsuranceProduct` portent de l'argent
      réel tant que la migration vers le journal n'a pas été lancée — le script
      les classe « supports à migrer », pas « doublons ». Les additionner à
      l'encours faisait diverger le module du patrimoine de 37 800 €.

      La règle : le journal fait foi, et ce qui l'attend est annoncé à part.
      Les fondre dans un total les rendrait invisibles ; les taire les perdrait.
    */
    const av = await getJson(request, "/api/life-insurance");
    const policies = (av.policies ?? []) as Array<{
      outstandingEur: string;
      legacyOutstandingEur: string;
    }>;

    expect(policies.length, "Aucun contrat d'assurance-vie").toBeGreaterThan(0);

    // Le total des contrats est la somme de leurs encours — rien d'autre.
    const somme = policies.reduce((a, p) => a + num(p.outstandingEur), 0);
    expect(
      somme,
      `La somme des encours (${somme}) doit faire le total annoncé (${av.totalOutstandingEur}).`
    ).toBeCloseTo(num(av.totalOutstandingEur), 2);

    // Le reliquat existe comme grandeur propre, hors encours.
    const reliquats = policies.reduce((a, p) => a + num(p.legacyOutstandingEur), 0);
    expect(reliquats).toBeCloseTo(num(av.totalLegacyOutstandingEur), 2);
    for (const p of policies) {
      expect(num(p.outstandingEur)).not.toBeNaN();
      expect(num(p.legacyOutstandingEur)).not.toBeNaN();
    }

    // Et les supports du journal restent bien la matière de l'encours.
    const supports = (await getJson(request, "/api/life-insurance/supports"))
      .supports as Array<{ currentValueEur: string; lifeInsuranceId: string | null }>;
    const rattaches = supports
      .filter((s) => s.lifeInsuranceId)
      .reduce((a, s) => a + num(s.currentValueEur), 0);
    expect(
      rattaches,
      "L'encours des contrats doit être celui de leurs supports au journal."
    ).toBeCloseTo(num(av.totalOutstandingEur), 2);
  });

  test("Passifs : le module et le patrimoine soustraient la même dette", async ({
    request,
  }) => {
    const portfolio = await getJson(request, "/api/portfolio");
    const liabilities = await getJson(request, "/api/liabilities");

    expectCoherent({
      family: "Passifs",
      dashboard: num(portfolio.summary?.totalLiabilitiesEur),
      module: num(liabilities.totalRemainingEur),
      moduleSource: `le capital restant dû de ${(liabilities.liabilities ?? []).length} crédit(s)`,
    });
  });

  test("Épargne salariale : le module et le patrimoine valorisent les mêmes lignes", async ({
    request,
  }) => {
    const portfolio = await getJson(request, "/api/portfolio");
    const savings = await getJson(request, "/api/employee-savings");

    expectCoherent({
      family: "Épargne salariale",
      dashboard: num(portfolio.summary?.totalEmployeeSavingsEur),
      module: num(savings.summary?.totalValue),
      moduleSource: `les ${(savings.lines ?? []).length} ligne(s) de plan, parts × valeur liquidative`,
    });
  });
});

/*
  ## Familles examinées et volontairement écartées

  Chacune échoue à l'une des conditions posées en tête de fichier. Les inclure
  produirait un rouge permanent qui n'apprendrait rien, ou un vert qui ne
  prouverait rien.

  - **Alternatifs** — les deux côtés appellent `getAlternativesPortfolioSlice`.
    Même fonction, donc assertion tautologique. À reprendre le jour où le
    module se dote d'un calcul propre.

  - **PEA / CTO** — le tableau de bord porte la valeur des positions ; le
    module porte la valeur liquidative des comptes-titres, qui inclut le cash
    d'enveloppe et exclut les lignes non rattachées. Deux notions distinctes,
    et l'écran le dit déjà par son bandeau de lignes non rattachées.

  - **Trading** — aucun total comparable : le patrimoine compte des actifs CFD
    du journal, le module montre des positions à levier et le solde d'un compte
    courtier. Aucune relation ne lie les deux en base.

  - **Crypto** — le total du tableau de bord couvre le comptant ; le module y
    ajoute DeFi, NFT et dérivés, dont les règles d'inclusion diffèrent
    (`isIgnoredInPortfolio`, statuts non détenus). Le jour où ces branches
    porteront des données, la comparaison demandera d'abord de fixer la notion.

  - **Cash** — les poches sont réparties entre comptes, livrets et enveloppes,
    dont deux écrans distincts n'affichent chacun qu'une partie. Aucun total de
    module ne recouvre le total du patrimoine.
*/

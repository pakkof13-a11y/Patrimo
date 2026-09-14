import { describe, expect, it, vi } from "vitest";

/**
 * Le total du module et celui du patrimoine valorisent les mêmes lignes : ils
 * doivent donc s'accorder au centime.
 *
 * ## Ce qui les faisait diverger
 *
 * `mapLine` publiait `marketValueEur` déjà arrondi au centime, et
 * `summarizeLines` relisait ces centimes pour les additionner en `number`
 * avant d'arrondir la somme une seconde fois. Chaque ligne perdait au plus un
 * demi-centime, ce qui ne se voit pas sur une ligne — mais les pertes ne se
 * compensent pas, elles s'additionnent.
 *
 * Le patrimoine (`getEmployeeSavingsTotalsEur`, `portfolio/service.ts`) somme
 * lui en Decimal plein et n'arrondit qu'à la sortie. Sur le jeu de
 * démonstration, les deux lecteurs annonçaient 47 377,02 € et 47 377,0346 € :
 * 1,46 centime d'écart, au-delà du centime que
 * `e2e/coherence-totaux.spec.ts` tolère entre deux chemins de calcul.
 *
 * Ce test rejoue ce jeu de lignes et vérifie les deux choses qui ne doivent
 * plus se produire : la somme des arrondis n'est plus le total, et l'écart au
 * total exact tient sous le centime.
 */

const findMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    employeeSavingsLine: {
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

/** Aucun appel réseau : tout est en euros ici, le taux ne sert qu'à la forme. */
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1 }) };
});

const { listEmployeeSavings } = await import(
  "@/app/lib/employee-savings/service"
);
const { Prisma } = await import("@/app/lib/prisma-client/client");
const { d, toFixed, zero } = await import("@/app/lib/money/decimal");

/**
 * Les douze lignes d'épargne salariale du jeu de démonstration
 * (`prisma/seed-portfolio.ts`) : les huit versements du patron P16, dont la
 * valeur liquidative porte quatre décimales (`10 × 1,05^(2026−année)`), et les
 * quatre lignes fixes du bloc « Épargne salariale ».
 *
 * Les valeurs sont recopiées plutôt que recalculées : ce test doit échouer si
 * l'agrégation change, pas suivre le seed. Le seed n'est pas modifié — ces
 * parts à quatre décimales sont précisément ce qui révèle le défaut.
 */
const DEMO: Array<{ units: string; nav: string; plan: string; bloque: boolean }> = [
  { units: "114", nav: "30.7152", plan: "PEE", bloque: false },
  { units: "140", nav: "26.533", plan: "PERCO", bloque: false },
  { units: "172", nav: "22.9202", plan: "PEE", bloque: false },
  { units: "210", nav: "19.7993", plan: "PERCO", bloque: false },
  { units: "258", nav: "17.1034", plan: "PEE", bloque: false },
  { units: "316", nav: "14.7746", plan: "PERCO", bloque: false },
  { units: "387", nav: "12.7628", plan: "PER", bloque: true },
  { units: "474", nav: "11.025", plan: "PEE", bloque: false },
  { units: "145.5", nav: "28.40", plan: "PEE", bloque: false },
  { units: "320", nav: "12.10", plan: "PEE", bloque: false },
  { units: "88.2", nav: "42.75", plan: "PER", bloque: true },
  { units: "55", nav: "18.90", plan: "PERCO", bloque: false },
];

function rows() {
  return DEMO.map((l, i) => ({
    id: `l${i}`,
    planType: l.plan,
    manager: "Amundi",
    fundName: "FCPE",
    isin: null,
    units: new Prisma.Decimal(l.units),
    nav: new Prisma.Decimal(l.nav),
    currency: "EUR",
    sourceType: "ABONDEMENT",
    contributionDate: null,
    contributedAmount: null,
    fundCategory: null,
    // Une date déjà passée rend la ligne disponible ; sans date et en mode
    // retraite, elle reste bloquée. Les deux cas sont représentés.
    unlockDate: l.bloque ? null : new Date(Date.UTC(2020, 0, 15)),
    unlockMode: l.bloque ? "RETIREMENT" : "DATE",
    notes: null,
  }));
}

/** Ce que le patrimoine compte : Σ(parts × VL) en Decimal, sans arrondi. */
const EXACT = DEMO.reduce(
  (acc, l) => acc.plus(d(l.units).times(d(l.nav))),
  zero()
);

describe("épargne salariale — agrégation des valorisations", () => {
  it("somme les valeurs pleines, puis arrondit une seule fois", async () => {
    findMany.mockResolvedValue(rows());
    const { lines, summary } = await listEmployeeSavings("u1");

    expect(lines).toHaveLength(12);
    expect(EXACT.toFixed(4)).toBe("47377.0346");

    // Le total est celui du patrimoine, arrondi au centime — pas la somme des
    // centimes de chaque ligne.
    expect(summary.totalValue).toBe(toFixed(EXACT, 2));
    expect(summary.totalValue).toBe("47377.03");
  });

  it("tient sous le centime d'écart avec le total du patrimoine", async () => {
    findMany.mockResolvedValue(rows());
    const { summary } = await listEmployeeSavings("u1");

    // La tolérance de `e2e/coherence-totaux.spec.ts`, vérifiée ici sans
    // navigateur ni base.
    const ecart = d(summary.totalValue).minus(EXACT).abs();
    expect(
      ecart.lte("0.01"),
      `Écart module ↔ patrimoine : ${ecart.toFixed(4)} € sur ${DEMO.length} lignes.`
    ).toBe(true);

    /*
      Et l'ancienne méthode est nommée pour que sa réapparition se voie : en
      additionnant les lignes déjà arrondies, le total tombait à 47 377,02 €,
      soit 1,46 centime sous la valeur exacte.
    */
    const sommeDesArrondis = DEMO.reduce(
      (acc, l) => acc.plus(d(toFixed(d(l.units).times(d(l.nav)), 2))),
      zero()
    );
    expect(toFixed(sommeDesArrondis, 2)).toBe("47377.02");
    expect(sommeDesArrondis.minus(EXACT).toFixed(4)).toBe("-0.0146");
    expect(summary.totalValue).not.toBe(toFixed(sommeDesArrondis, 2));
  });

  it("répartit le même total sans en perdre un centime en chemin", async () => {
    findMany.mockResolvedValue(rows());
    const { summary } = await listEmployeeSavings("u1");

    // Disponible + bloqué = total, et les deux parts font 100 %.
    const parts = d(summary.availableValue).plus(d(summary.blockedValue));
    expect(toFixed(parts, 2)).toBe(summary.totalValue);
    expect(summary.availablePct + summary.blockedPct).toBeCloseTo(100, 10);

    // Chaque répartition couvre le total : un arrondi par groupe, jamais un
    // groupe qui s'évapore.
    const parPlan = summary.byPlanType.reduce((a, b) => a.plus(d(b.value)), zero());
    const parGestionnaire = summary.byManager.reduce(
      (a, b) => a.plus(d(b.value)),
      zero()
    );
    const parSource = summary.bySource.reduce((a, b) => a.plus(d(b.value)), zero());
    for (const somme of [parPlan, parGestionnaire, parSource]) {
      expect(somme.minus(d(summary.totalValue)).abs().lte("0.02")).toBe(true);
    }

    // La frise porte elle aussi le total, arrondi par seau.
    const frise = summary.unlockTimeline.reduce(
      (a, b) => a.plus(d(b.amount)),
      zero()
    );
    expect(frise.minus(d(summary.totalValue)).abs().lte("0.02")).toBe(true);
  });
});

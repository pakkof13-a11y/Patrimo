import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";

/**
 * Journal des constats de trésorerie d'enveloppe.
 *
 * `EnvelopeCash` ne portait que son solde courant et ses horodatages
 * techniques. L'historique s'ancrait donc sur `updatedAt`, que Prisma réécrit à
 * **chaque** écriture de la ligne : modifier le solde déplaçait le point où la
 * trésorerie apparaît dans le passé et effaçait ce que l'on savait de l'état
 * précédent. La donnée n'était pas seulement absente — elle était détruite à
 * chaque saisie.
 *
 * Ses deux modèles frères, comptes bancaires et livrets, ont ce journal depuis
 * toujours. Les constats d'enveloppe empruntent donc le même chemin : ils sont
 * versés dans `cashEvents`, et le compartiment de trésorerie les traite comme
 * les autres. Ces tests exercent ce chemin de bout en bout, par le moteur.
 *
 * ## Ce que le journal ne fait pas
 *
 * Il ne reconstruit aucun passé. Une enveloppe sans constat reste ce qu'elle
 * était : un solde connu à sa dernière écriture, et rien avant.
 */

const t = (iso: string) => new Date(iso);

function inputs(over: Partial<HistoricalInputs> = {}): HistoricalInputs {
  return {
    transactions: [],
    assetClassById: new Map(),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
    excludedAssetIds: new Set(),
    closes: new Map(),
    cashAccounts: [],
    cashEvents: [],
    metals: [],
    privateEquity: [],
    crowdlending: [],
    tangibles: [],
    employeeSavings: [],
    liabilities: [],
    ...over,
  };
}

/**
 * Une enveloppe telle que `load.ts` la transmet.
 *
 * `knownAt` est son `updatedAt` : l'ancre de repli, utilisée tant qu'aucun
 * constat n'existe.
 */
function enveloppe(id: string, soldeEur: number, knownAt: string) {
  return {
    id,
    balanceEur: d(soldeEur),
    createdAt: t("2020-01-01T00:00:00Z"),
    knownAt: t(knownAt),
  };
}

/** Un constat, tel que la route de saisie l'écrit puis que `load.ts` le mappe. */
function constat(
  accountId: string,
  iso: string,
  soldeApres: number,
  ecart: number
) {
  return {
    accountId,
    occurredAt: t(iso),
    amountEur: d(ecart),
    balanceAfterEur: d(soldeApres),
    // Jamais `INTEREST` : l'écart est un flux de capital, pas de la performance.
    type: "OBSERVED",
  };
}

const serie = (e: PortfolioValuationEngine, from: string, to: string) =>
  e.buildSeries(from, to).map((p) => ({
    day: p.day,
    cash: p.cash,
    flux: p.externalFlows,
    perf: p.investmentPerformance,
    statut: p.status,
  }));

const cashAu = (e: PortfolioValuationEngine, jour: string) =>
  serie(e, jour, jour)[0]!.cash;

describe("sans constat, rien n'est inventé", () => {
  const sansJournal = inputs({
    cashAccounts: [enveloppe("env-cto", 5_200, "2026-08-20T10:00:00Z")],
  });

  it("aucune valeur avant la date où le solde est connu", () => {
    const e = new PortfolioValuationEngine(sansJournal);
    expect(cashAu(e, "2024-01-01")).toBe(0);
    expect(cashAu(e, "2026-08-19")).toBe(0);
  });

  it("le solde apparaît à sa date de connaissance, et pas avant", () => {
    const e = new PortfolioValuationEngine(sansJournal);
    expect(cashAu(e, "2026-08-20")).toBeCloseTo(5_200, 6);
  });
});

describe("le premier constat ouvre l'histoire", () => {
  const unConstat = inputs({
    cashAccounts: [enveloppe("env-cto", 5_000, "2026-03-10T09:00:00Z")],
    cashEvents: [constat("env-cto", "2026-03-10T09:00:00Z", 5_000, 5_000)],
  });

  it("rien avant le constat", () => {
    const e = new PortfolioValuationEngine(unConstat);
    expect(cashAu(e, "2026-03-09")).toBe(0);
  });

  it("la valeur devient disponible exactement à sa date", () => {
    const e = new PortfolioValuationEngine(unConstat);
    expect(cashAu(e, "2026-03-10")).toBeCloseTo(5_000, 6);
  });

  it("et se reporte ensuite tant que rien ne la contredit", () => {
    const e = new PortfolioValuationEngine(unConstat);
    expect(cashAu(e, "2026-05-01")).toBeCloseTo(5_000, 6);
  });

  it("le constat compte comme un apport, jamais comme de la performance", () => {
    /*
      L'écart entre deux constats est du capital. Rien ne permet de distinguer
      un versement d'un intérêt — la saisie ne demande qu'un solde — et
      créditer la performance d'un montant inexpliqué serait le seul choix
      vraiment faux.
    */
    const e = new PortfolioValuationEngine(unConstat);
    const p = serie(e, "2026-03-10", "2026-03-10")[0]!;
    expect(p.flux).toBeCloseTo(5_000, 6);
    expect(p.perf).toBeCloseTo(0, 6);
  });
});

describe("deux constats", () => {
  const deux = inputs({
    cashAccounts: [enveloppe("env-cto", 5_200, "2026-06-15T09:00:00Z")],
    cashEvents: [
      constat("env-cto", "2026-03-10T09:00:00Z", 5_000, 5_000),
      constat("env-cto", "2026-06-15T09:00:00Z", 5_200, 200),
    ],
  });

  it("la valeur reste stable entre les deux", () => {
    const e = new PortfolioValuationEngine(deux);
    expect(cashAu(e, "2026-04-01")).toBeCloseTo(5_000, 6);
    expect(cashAu(e, "2026-06-14")).toBeCloseTo(5_000, 6);
  });

  it("le second constat prend effet à sa date exacte", () => {
    const e = new PortfolioValuationEngine(deux);
    expect(cashAu(e, "2026-06-15")).toBeCloseTo(5_200, 6);
  });

  it("le premier constat survit au second", () => {
    /*
      Le cœur du chantier. Avant le journal, saisir 5 200 € en juin déplaçait
      l'ancre à juin : les 5 000 € de mars disparaissaient de l'historique, et
      la courbe ne commençait plus qu'en juin. Le journal accumule.
    */
    const e = new PortfolioValuationEngine(deux);
    expect(cashAu(e, "2026-03-10")).toBeCloseTo(5_000, 6);
  });

  it("seul l'écart est compté en flux, pas le solde entier", () => {
    const e = new PortfolioValuationEngine(deux);
    const p = serie(e, "2026-06-15", "2026-06-15")[0]!;
    expect(p.flux).toBeCloseTo(200, 6);
    expect(p.perf).toBeCloseTo(0, 6);
  });
});

describe("date frontière", () => {
  /*
    Un constat à midi vaut pour la journée entière : la chronologie du moteur
    est quotidienne, et le point du jour décrit sa clôture.
  */
  const midi = inputs({
    cashAccounts: [enveloppe("env-cto", 900, "2026-04-02T12:00:00Z")],
    cashEvents: [
      constat("env-cto", "2026-04-01T12:00:00Z", 700, 700),
      constat("env-cto", "2026-04-02T12:00:00Z", 900, 200),
    ],
  });

  it("la veille porte l'ancien état", () => {
    const e = new PortfolioValuationEngine(midi);
    expect(cashAu(e, "2026-04-01")).toBeCloseTo(700, 6);
  });

  it("le jour même porte le nouveau", () => {
    const e = new PortfolioValuationEngine(midi);
    expect(cashAu(e, "2026-04-02")).toBeCloseTo(900, 6);
  });

  it("et rien la veille du premier constat", () => {
    const e = new PortfolioValuationEngine(midi);
    expect(cashAu(e, "2026-03-31")).toBe(0);
  });
});

describe("plusieurs enveloppes", () => {
  const deuxEnveloppes = inputs({
    cashAccounts: [
      enveloppe("env-cto", 5_000, "2026-03-10T09:00:00Z"),
      enveloppe("env-pea", 2_000, "2026-07-01T09:00:00Z"),
    ],
    cashEvents: [
      constat("env-cto", "2026-03-10T09:00:00Z", 5_000, 5_000),
      constat("env-pea", "2026-07-01T09:00:00Z", 2_000, 2_000),
    ],
  });

  it("chacune ouvre son histoire à sa propre date", () => {
    const e = new PortfolioValuationEngine(deuxEnveloppes);
    // Le CTO seul en avril, les deux en juillet.
    expect(cashAu(e, "2026-04-01")).toBeCloseTo(5_000, 6);
    expect(cashAu(e, "2026-07-01")).toBeCloseTo(7_000, 6);
  });

  it("le constat de l'une ne déplace pas l'autre", () => {
    const e = new PortfolioValuationEngine(deuxEnveloppes);
    expect(cashAu(e, "2026-06-30")).toBeCloseTo(5_000, 6);
  });
});

describe("chronologie", () => {
  it("plusieurs constats successifs se résolvent dans l'ordre des dates", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [enveloppe("env-cto", 1_300, "2026-05-01T09:00:00Z")],
        cashEvents: [
          constat("env-cto", "2026-01-15T09:00:00Z", 1_000, 1_000),
          constat("env-cto", "2026-03-01T09:00:00Z", 1_100, 100),
          constat("env-cto", "2026-05-01T09:00:00Z", 1_300, 200),
        ],
      })
    );
    expect(cashAu(e, "2026-02-01")).toBeCloseTo(1_000, 6);
    expect(cashAu(e, "2026-04-01")).toBeCloseTo(1_100, 6);
    expect(cashAu(e, "2026-06-01")).toBeCloseTo(1_300, 6);
  });

  it("l'ordre d'insertion ne fait pas foi, la date métier oui", () => {
    /*
      Les mêmes constats, versés à l'envers. Le compartiment les trie sur
      `occurredAt` : une écriture rejouée dans le désordre — reprise de
      sauvegarde, réplication — ne doit pas réécrire la chronologie.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [enveloppe("env-cto", 1_300, "2026-05-01T09:00:00Z")],
        cashEvents: [
          constat("env-cto", "2026-05-01T09:00:00Z", 1_300, 200),
          constat("env-cto", "2026-01-15T09:00:00Z", 1_000, 1_000),
          constat("env-cto", "2026-03-01T09:00:00Z", 1_100, 100),
        ],
      })
    );
    expect(cashAu(e, "2026-02-01")).toBeCloseTo(1_000, 6);
    expect(cashAu(e, "2026-04-01")).toBeCloseTo(1_100, 6);
    expect(cashAu(e, "2026-06-01")).toBeCloseTo(1_300, 6);
  });
});

describe("valeur, flux et performance restent cohérents", () => {
  it("un solde qui monte par constats ne produit aucune performance", () => {
    /*
      L'identité du moteur : performance = variation de valeur − flux. Un
      journal de trésorerie ne doit rien y ajouter, puisque chaque écart est
      déclaré comme flux.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [enveloppe("env-cto", 1_500, "2026-02-01T09:00:00Z")],
        cashEvents: [
          constat("env-cto", "2026-01-01T09:00:00Z", 1_000, 1_000),
          constat("env-cto", "2026-02-01T09:00:00Z", 1_500, 500),
        ],
      })
    );
    const s = serie(e, "2026-01-01", "2026-02-01");
    const perfCumulee = s.reduce((t, p) => t + p.perf, 0);
    const fluxCumules = s.reduce((t, p) => t + p.flux, 0);

    expect(fluxCumules).toBeCloseTo(1_500, 6);
    expect(perfCumulee).toBeCloseTo(0, 6);
  });

  it("un retrait constaté sort en flux négatif, pas en perte", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [enveloppe("env-cto", 400, "2026-02-01T09:00:00Z")],
        cashEvents: [
          constat("env-cto", "2026-01-01T09:00:00Z", 1_000, 1_000),
          constat("env-cto", "2026-02-01T09:00:00Z", 400, -600),
        ],
      })
    );
    const p = serie(e, "2026-02-01", "2026-02-01")[0]!;
    expect(p.flux).toBeCloseTo(-600, 6);
    expect(p.perf).toBeCloseTo(0, 6);
  });
});

describe("performance du moteur", () => {
  it("une longue série avec constats ne coûte pas d'ordre de grandeur", () => {
    /*
      Les constats sont préchargés et transformés une seule fois en chronologie,
      comme ceux des comptes bancaires : la boucle des jours n'y fait aucune
      résolution répétée. Le budget est large — on garde une régression d'un
      ordre de grandeur, pas une variation de machine.
    */
    const constats = [];
    for (let i = 0; i < 200; i++) {
      const jour = new Date(Date.UTC(2020, 0, 1 + i * 5, 9));
      constats.push(
        constat("env-cto", jour.toISOString(), 1_000 + i * 10, 10)
      );
    }
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [enveloppe("env-cto", 2_990, "2022-09-01T09:00:00Z")],
        cashEvents: constats,
      })
    );

    const debut = Date.now();
    const points = e.buildSeries("2020-01-01", "2026-08-31");
    const duree = Date.now() - debut;

    expect(points.length).toBeGreaterThan(2_400);
    expect(duree).toBeLessThan(4_000);
  });
});

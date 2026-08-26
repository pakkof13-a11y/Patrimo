import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";

/**
 * La trésorerie du passé n'est pas celle d'aujourd'hui.
 *
 * Un compte sans aucun événement daté portait son solde **courant** rattaché à
 * sa date de création : un compte ouvert en 2020 affichait 10 000 € depuis
 * 2020, alors que rien ne prouve qu'ils s'y trouvaient déjà. La valeur était
 * réelle, son application au passé ne l'était pas.
 *
 * L'ancre est désormais la date à laquelle le solde est **connu**. Avant elle,
 * le compte existe mais rien n'est su de lui — et le compartiment le dit au
 * lieu de compter zéro en silence.
 */

const t = (iso: string) => new Date(iso);

function inputs(over: Partial<HistoricalInputs> = {}): HistoricalInputs {
  return {
    transactions: [], assetClassById: new Map(), excludedAssetIds: new Set(),
    closes: new Map(), cashAccounts: [], cashEvents: [], metals: [],
    privateEquity: [], crowdlending: [], tangibles: [], employeeSavings: [],
    liabilities: [], ...over,
  };
}

const valeurs = (e: PortfolioValuationEngine, from: string, to: string) =>
  e.buildSeries(from, to).map((p) => ({
    day: p.day,
    cash: p.cash,
    statut: p.status,
    estimes: p.estimatedComponents,
  }));

// ── 1 ────────────────────────────────────────────────────────────────────────
describe("1 — compte sans aucun événement historique", () => {
  const compte = inputs({
    cashAccounts: [
      {
        id: "b1",
        balanceEur: d(10_000),
        createdAt: t("2020-01-01T00:00:00Z"),
        // Le solde n'a été écrit qu'aujourd'hui.
        knownAt: t("2026-08-20T00:00:00Z"),
      },
    ],
  });

  it("rien avant la date où le solde est connu", () => {
    const e = new PortfolioValuationEngine(compte);
    const serie = valeurs(e, "2026-08-17", "2026-08-19");
    expect(serie.map((p) => p.cash)).toEqual([0, 0, 0]);
  });

  it("les 10 000 € n'apparaissent pas en 2020", () => {
    /*
      Le cœur du correctif. Avant, ce point rendait 10 000 € — un solde
      d'aujourd'hui projeté six ans en arrière.
    */
    const e = new PortfolioValuationEngine(compte);
    expect(valeurs(e, "2020-06-01", "2020-06-01")[0]!.cash).toBe(0);
  });

  it("le compartiment se déclare inconnu, pas exact", () => {
    /*
      Un zéro silencieux serait pire que la rétro-projection : il affirmerait
      une absence de trésorerie. Le compte existe et n'est pas connu — le
      statut doit le dire.
    */
    const e = new PortfolioValuationEngine(compte);
    const avant = valeurs(e, "2026-08-18", "2026-08-18")[0]!;
    expect(avant.estimes).toContain("cash");
    expect(avant.statut).toBe("ESTIMATED");
  });

  it("à partir de la date connue, le solde apparaît", () => {
    const e = new PortfolioValuationEngine(compte);
    const serie = valeurs(e, "2026-08-19", "2026-08-21");
    expect(serie.map((p) => p.cash)).toEqual([0, 10_000, 10_000]);
  });
});

// ── 2, 3, 4, 5 ───────────────────────────────────────────────────────────────
describe("2 à 5 — compte doté d'observations datées", () => {
  const avecEvenements = inputs({
    cashAccounts: [
      {
        id: "b1",
        balanceEur: d(10_000),
        createdAt: t("2020-01-01T00:00:00Z"),
        knownAt: t("2026-08-26T00:00:00Z"),
      },
    ],
    cashEvents: [
      {
        accountId: "b1", occurredAt: t("2026-08-21T00:00:00Z"),
        amountEur: d(4_000), balanceAfterEur: d(4_000), type: "OPENING",
      },
      {
        accountId: "b1", occurredAt: t("2026-08-24T00:00:00Z"),
        amountEur: d(6_000), balanceAfterEur: d(10_000), type: "DEPOSIT",
      },
    ],
  });

  it("5 — rien avant la première observation", () => {
    const e = new PortfolioValuationEngine(avecEvenements);
    expect(valeurs(e, "2026-08-20", "2026-08-20")[0]!.cash).toBe(0);
  });

  it("2 et 3 — le 21 août vaut 4 000 €, pas les 10 000 € d'aujourd'hui", () => {
    const e = new PortfolioValuationEngine(avecEvenements);
    expect(valeurs(e, "2026-08-21", "2026-08-21")[0]!.cash).toBe(4_000);
  });

  it("4 — entre deux observations, la dernière connue est reportée", () => {
    const e = new PortfolioValuationEngine(avecEvenements);
    const serie = valeurs(e, "2026-08-21", "2026-08-25");
    expect(serie.map((p) => p.cash)).toEqual([4_000, 4_000, 4_000, 10_000, 10_000]);
  });

  it("le jour d'une observation est exact, le lendemain est reporté", () => {
    const e = new PortfolioValuationEngine(avecEvenements);
    const serie = valeurs(e, "2026-08-21", "2026-08-22");
    expect(serie[0]!.estimes).not.toContain("cash");
    expect(serie[1]!.estimes).toContain("cash");
  });
});

// ── 7, 8 ─────────────────────────────────────────────────────────────────────
describe("7 et 8 — la valeur courante ne bouge pas", () => {
  it("le dernier point porte toujours le solde actuel", () => {
    /*
      Le correctif ne concerne que le passé. Ce que le tableau de bord affiche
      aujourd'hui doit rester identique au centime.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          {
            id: "b1", balanceEur: d(10_000),
            createdAt: t("2020-01-01T00:00:00Z"),
            knownAt: t("2026-08-20T00:00:00Z"),
          },
        ],
      })
    );
    expect(e.calculateAt("2026-08-26").cash).toBe(10_000);
    expect(e.calculateAt("2026-08-26").grossAssets).toBe(10_000);
  });

  it("un compte encore actif garde son solde après sa dernière observation", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          {
            id: "b1", balanceEur: d(10_000),
            createdAt: t("2020-01-01T00:00:00Z"),
            knownAt: t("2026-08-26T00:00:00Z"),
          },
        ],
        cashEvents: [
          {
            accountId: "b1", occurredAt: t("2026-08-21T00:00:00Z"),
            amountEur: d(10_000), balanceAfterEur: d(10_000), type: "OPENING",
          },
        ],
      })
    );
    expect(e.calculateAt("2026-08-26").cash).toBe(10_000);
  });
});

// ── 9, 10 ────────────────────────────────────────────────────────────────────
describe("9 et 10 — cash inconnu au milieu d'autres composantes", () => {
  const mixte = inputs({
    cashAccounts: [
      {
        id: "b1", balanceEur: d(10_000),
        createdAt: t("2020-01-01T00:00:00Z"),
        knownAt: t("2026-08-20T00:00:00Z"),
      },
    ],
    tangibles: [
      {
        id: "tg1", purchaseDate: t("2024-01-01T00:00:00Z"),
        createdAt: t("2024-01-01T00:00:00Z"), updatedAt: t("2024-01-01T00:00:00Z"),
        costEur: d(50_000), estimatedValueEur: d(50_000), valuations: [],
      },
    ],
  });

  it("les autres composantes ne sont pas dégradées", () => {
    /*
      Marquer le cash inconnu ne doit rien dire des alternatifs : ils ont leur
      propre constat daté, et il tient.
    */
    const p = new PortfolioValuationEngine(mixte).calculateAt("2026-08-18");
    expect(p.cash).toBe(0);
    expect(p.alternatives).toBe(50_000);
    expect(p.estimatedComponents).toContain("cash");
  });

  it("le brut ne compte que ce qui est connu", () => {
    const p = new PortfolioValuationEngine(mixte).calculateAt("2026-08-18");
    // 50 000 d'alternatifs, et rien de trésorerie : pas 60 000.
    expect(p.grossAssets).toBe(50_000);
  });

  it("une fois le cash connu, le brut les additionne", () => {
    const p = new PortfolioValuationEngine(mixte).calculateAt("2026-08-21");
    expect(p.grossAssets).toBe(60_000);
  });
});

// ── Flux ─────────────────────────────────────────────────────────────────────
describe("le flux suit la valeur, jamais séparément", () => {
  it("l'apport est daté du jour où le solde apparaît", () => {
    /*
      Dissocier les deux ferait apparaître un apport un jour où la valeur ne
      bouge pas — donc une perte de performance du même montant, purement
      comptable.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          {
            id: "b1", balanceEur: d(10_000),
            createdAt: t("2020-01-01T00:00:00Z"),
            knownAt: t("2026-08-20T00:00:00Z"),
          },
        ],
      })
    );
    const serie = e.buildSeries("2026-08-19", "2026-08-21");
    const arrivee = serie.find((p) => p.day === "2026-08-20")!;
    expect(arrivee.cash).toBe(10_000);
    expect(arrivee.externalFlows).toBe(10_000);
    // Et donc aucune performance fabriquée par cette arrivée.
    expect(arrivee.investmentPerformance).toBe(0);
  });
});

// ── Compatibilité ────────────────────────────────────────────────────────────
describe("sans date connue, le comportement d'avant subsiste", () => {
  it("un appelant qui ne fournit pas knownAt retombe sur la création", () => {
    /*
      `knownAt` est optionnel : les tests et appelants existants qui ne le
      passent pas gardent l'ancre de création. Le correctif vient de
      l'adaptateur, qui la renseigne désormais toujours.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          { id: "b1", balanceEur: d(10_000), createdAt: t("2026-08-20T00:00:00Z") },
        ],
      })
    );
    expect(e.calculateAt("2026-08-21").cash).toBe(10_000);
    expect(e.calculateAt("2026-08-19").cash).toBe(0);
  });
});

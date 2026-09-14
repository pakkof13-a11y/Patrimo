import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";

/**
 * D26 point 2 — un patrimoine sans journal.
 *
 * Un compte dont la seule trésorerie est saisie à la main (solde courant,
 * aucun `CashEvent`) et qui ne porte aucune transaction au journal : rien
 * n'est jamais « observé » au sens de `ValueTimeline.earliestObservedDay`,
 * seulement « connu » (`observed: false`) à la date de sa dernière saisie.
 *
 * Avant le correctif, `earliestDayForScope` — et `earliestDay()` lui-même,
 * dont Brut/Net dépendent — ne trouvaient aucun candidat et rendaient `null`.
 * `getDailyNav` aurait donc rendu une série vide pour un compte qui a
 * pourtant une trésorerie bien réelle.
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

describe("D26.2 — cash saisi à la main, sans aucun événement ni transaction", () => {
  const soldeSeul = inputs({
    cashAccounts: [
      {
        id: "b1",
        balanceEur: d(10_000),
        createdAt: t("2020-01-01T00:00:00Z"),
        knownAt: t("2026-08-20T00:00:00Z"),
      },
    ],
  });

  it("la borne « cash » retombe sur le jour connu, pas sur null", () => {
    const e = new PortfolioValuationEngine(soldeSeul);
    expect(e.earliestDayForScope("cash")).toBe("2026-08-20");
  });

  it("la borne « financier » (qui compose le cash) hérite du même repli", () => {
    const e = new PortfolioValuationEngine(soldeSeul);
    expect(e.earliestDayForScope("financier")).toBe("2026-08-20");
  });

  it("la borne « brut »/« net » (earliestDay) retombe aussi sur le jour connu", () => {
    const e = new PortfolioValuationEngine(soldeSeul);
    expect(e.earliestDayForScope("brut")).toBe("2026-08-20");
    expect(e.earliestDayForScope("net")).toBe("2026-08-20");
  });

  it("un compte réellement vide (aucune source) reste null — pas de date inventée", () => {
    const e = new PortfolioValuationEngine(inputs());
    expect(e.earliestDayForScope("cash")).toBeNull();
    expect(e.earliestDayForScope("brut")).toBeNull();
  });

  it("un compte avec observation réelle ailleurs ne recule pas sur un repli non observé", () => {
    // Le cash n'a pas d'événement (repli), mais une transaction titres réelle
    // et antérieure existe : la borne « brut » doit rester celle-ci, pas le
    // repli du cash — le repli n'intervient qu'en dernier recours, quand
    // *rien* n'est observé nulle part. Date choisie sous le cap de six ans
    // (`MAX_HISTORY_YEARS`) pour ne pas confondre ce test avec lui.
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: soldeSeul.cashAccounts,
        transactions: [
          {
            id: "tx1",
            type: "ACHAT",
            platformId: "p1",
            toPlatformId: null,
            assetId: "aapl",
            quantity: d(1),
            unitPrice: d(100),
            fees: d(0),
            currency: "EUR",
            fxRateToEur: d(1),
            grossOriginal: d(100),
            cashAmountOriginal: d(100),
            occurredAt: t("2021-06-01T00:00:00Z"),
          },
        ],
      })
    );
    expect(e.earliestDayForScope("brut")).toBe("2021-06-01");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildValuationTimeline,
  isStaleValuation,
  STALE_VALUATION_DAYS,
} from "@/app/lib/tangibles/valuation-history";

const NOW = new Date("2026-08-02T12:00:00Z");

describe("chronologie de valeur d'un objet tangible", () => {
  it("ouvre la série sur le prix d'achat, frais compris", () => {
    /*
      Sans le point d'achat, la courbe partirait de la première expertise : la
      performance des années précédentes disparaîtrait de l'écran.
    */
    const t = buildValuationTimeline({
      purchasePriceEur: 10000,
      acquisitionFeesEur: 500,
      purchaseDate: "2020-06-01",
      valuations: [
        { valuedAt: "2024-06-01", valueEur: 14000, source: "APPRAISAL" },
      ],
      now: NOW,
    });
    expect(t.points[0]).toMatchObject({ valueEur: 10500, source: "PURCHASE" });
    expect(t.points).toHaveLength(2);
    expect(t.currentValueEur).toBe(14000);
  });

  it("mesure la plus-value sur le prix de revient, jamais sur le prix nu", () => {
    const t = buildValuationTimeline({
      purchasePriceEur: 10000,
      acquisitionFeesEur: 500,
      purchaseDate: "2020-06-01",
      valuations: [
        { valuedAt: "2024-06-01", valueEur: 14000, source: "AUCTION" },
      ],
      now: NOW,
    });
    // 14 000 − 10 500, et non 14 000 − 10 000.
    expect(t.pnlEur).toBe(3500);
    expect(t.pnlPct).toBeCloseTo(33.3333, 3);
  });

  it("ordonne les valorisations quelle que soit leur saisie", () => {
    const t = buildValuationTimeline({
      purchasePriceEur: 1000,
      purchaseDate: "2021-01-01",
      valuations: [
        { valuedAt: "2025-01-01", valueEur: 1800, source: "MARKET" },
        { valuedAt: "2023-01-01", valueEur: 1400, source: "MARKET" },
      ],
      now: NOW,
    });
    expect(t.points.map((p) => p.valueEur)).toEqual([1000, 1400, 1800]);
    expect(t.currentValueEur).toBe(1800);
  });

  it("annualise au-delà d'un an, et se tait en deçà", () => {
    /*
      Ramener trois semaines de hausse à un taux annuel produit des
      pourcentages à trois chiffres qui ne décrivent rien.
    */
    const court = buildValuationTimeline({
      purchasePriceEur: 1000,
      purchaseDate: "2026-07-01",
      valuations: [
        { valuedAt: "2026-07-22", valueEur: 1100, source: "MANUAL" },
      ],
      now: NOW,
    });
    expect(court.pnlPct).toBeCloseTo(10, 6);
    expect(court.annualisedPct).toBeNull();

    // 1 000 → 1 210 en deux ans : 10 % par an.
    const long = buildValuationTimeline({
      purchasePriceEur: 1000,
      purchaseDate: "2023-01-01",
      valuations: [
        { valuedAt: "2025-01-01", valueEur: 1210, source: "APPRAISAL" },
      ],
      now: NOW,
    });
    expect(long.annualisedPct).toBeCloseTo(10, 1);
  });

  it("écarte une valorisation sans date ou sans montant", () => {
    const t = buildValuationTimeline({
      purchasePriceEur: 1000,
      purchaseDate: "2021-01-01",
      valuations: [
        { valuedAt: "pas-une-date", valueEur: 5000, source: "MANUAL" },
        { valuedAt: "2024-01-01", valueEur: 0, source: "MANUAL" },
      ],
      now: NOW,
    });
    expect(t.points).toHaveLength(1);
    expect(t.currentValueEur).toBe(1000);
  });

  it("dit l'âge de la dernière valorisation, et signale la péremption", () => {
    const t = buildValuationTimeline({
      purchasePriceEur: 1000,
      purchaseDate: "2018-01-01",
      valuations: [
        { valuedAt: "2020-01-01", valueEur: 1500, source: "APPRAISAL" },
      ],
      now: NOW,
    });
    expect(t.staleDays).toBeGreaterThan(STALE_VALUATION_DAYS);
    expect(isStaleValuation(t.staleDays)).toBe(true);
    expect(isStaleValuation(30)).toBe(false);
    expect(isStaleValuation(null)).toBe(false);
  });

  it("ne prétend rien sur un objet sans prix d'achat connu", () => {
    const t = buildValuationTimeline({
      valuations: [
        { valuedAt: "2025-01-01", valueEur: 2000, source: "MARKET" },
      ],
      now: NOW,
    });
    expect(t.currentValueEur).toBe(2000);
    expect(t.pnlEur).toBeNull();
    expect(t.pnlPct).toBeNull();
  });
});

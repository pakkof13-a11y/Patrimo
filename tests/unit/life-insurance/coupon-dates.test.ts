import { describe, expect, it } from "vitest";
import {
  addMonthsUtc,
  couponObservationDates,
  monthsBetweenObservations,
} from "@/app/lib/life-insurance/coupon-dates";

const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const keys = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10));

describe("monthsBetweenObservations", () => {
  it("traduit la périodicité en pas de mois", () => {
    expect(monthsBetweenObservations("MONTHLY")).toBe(1);
    expect(monthsBetweenObservations("QUARTERLY")).toBe(3);
    expect(monthsBetweenObservations("SEMIANNUAL")).toBe(6);
    expect(monthsBetweenObservations("ANNUAL")).toBe(12);
  });

  it("rend 0 pour un versement au terme", () => {
    expect(monthsBetweenObservations("MATURITY")).toBe(0);
  });
});

describe("addMonthsUtc", () => {
  it("conserve le jour du mois", () => {
    expect(keys([addMonthsUtc(at("2024-03-20"), 3)])).toEqual(["2024-06-20"]);
  });

  it("rogne le jour sur un mois plus court", () => {
    // 31 janvier + 3 mois = 30 avril, pas 1er mai : laisser JavaScript
    // déborder décalerait toute la série.
    expect(keys([addMonthsUtc(at("2024-01-31"), 3)])).toEqual(["2024-04-30"]);
  });

  it("gère le 29 février d'une année non bissextile", () => {
    expect(keys([addMonthsUtc(at("2024-02-29"), 12)])).toEqual(["2025-02-28"]);
  });

  it("traverse les années", () => {
    expect(keys([addMonthsUtc(at("2024-11-15"), 6)])).toEqual(["2025-05-15"]);
  });
});

describe("couponObservationDates", () => {
  const base = {
    strikeDate: at("2024-03-20"),
    maturityDate: at("2031-03-20"),
    couponFrequency: "QUARTERLY",
    lastCouponAppliedAt: null,
  };

  it("suit l'anniversaire de la constatation, par pas trimestriel", () => {
    const dates = couponObservationDates({ ...base, now: at("2025-01-15") });
    expect(keys(dates)).toEqual([
      "2024-06-20",
      "2024-09-20",
      "2024-12-20",
    ]);
  });

  it("exclut la constatation initiale elle-même", () => {
    // Le 20 mars 2024 est l'origine de la série, pas une échéance de coupon.
    const dates = couponObservationDates({ ...base, now: at("2024-06-19") });
    expect(keys(dates)).toEqual([]);
  });

  it("inclut une constatation tombant le jour même", () => {
    const dates = couponObservationDates({ ...base, now: at("2024-06-20") });
    expect(keys(dates)).toEqual(["2024-06-20"]);
  });

  it("reprend après le curseur", () => {
    const dates = couponObservationDates({
      ...base,
      lastCouponAppliedAt: at("2024-09-20"),
      now: at("2025-01-15"),
    });
    expect(keys(dates)).toEqual(["2024-12-20"]);
  });

  it("s'arrête à l'échéance", () => {
    const dates = couponObservationDates({
      ...base,
      maturityDate: at("2024-09-20"),
      now: at("2026-01-01"),
    });
    expect(keys(dates)).toEqual(["2024-06-20", "2024-09-20"]);
  });

  it("compte quatre échéances par an en trimestriel", () => {
    const dates = couponObservationDates({ ...base, now: at("2025-03-20") });
    // 4 trimestres écoulés depuis mars 2024, dont l'anniversaire de mars 2025.
    expect(keys(dates)).toEqual([
      "2024-06-20",
      "2024-09-20",
      "2024-12-20",
      "2025-03-20",
    ]);
  });

  it("ne propose qu'une échéance par an en annuel", () => {
    const dates = couponObservationDates({
      ...base,
      couponFrequency: "ANNUAL",
      now: at("2026-01-01"),
    });
    expect(keys(dates)).toEqual(["2025-03-20"]);
  });

  describe("versement au terme (MATURITY)", () => {
    const maturityOnly = {
      strikeDate: at("2024-03-20"),
      maturityDate: at("2031-03-20"),
      couponFrequency: "MATURITY",
      lastCouponAppliedAt: null,
    };

    it("ne propose aucun coupon intermédiaire", () => {
      // Annoncer des coupons trimestriels sur un produit capitalisant
      // promettrait des revenus qu'il ne verse pas.
      const dates = couponObservationDates({
        ...maturityOnly,
        now: at("2028-01-01"),
      });
      expect(keys(dates)).toEqual([]);
    });

    it("propose l'échéance une fois atteinte", () => {
      const dates = couponObservationDates({
        ...maturityOnly,
        now: at("2031-04-01"),
      });
      expect(keys(dates)).toEqual(["2031-03-20"]);
    });

    it("ne la propose plus une fois réglée", () => {
      const dates = couponObservationDates({
        ...maturityOnly,
        lastCouponAppliedAt: at("2031-03-20"),
        now: at("2031-04-01"),
      });
      expect(keys(dates)).toEqual([]);
    });
  });

  it("ne propose rien sans constatation initiale", () => {
    // Sans origine, la série serait inventée.
    const dates = couponObservationDates({
      ...base,
      strikeDate: null,
      now: at("2026-01-01"),
    });
    expect(keys(dates)).toEqual([]);
  });

  it("ne propose rien sans échéance pour un produit au terme", () => {
    const dates = couponObservationDates({
      strikeDate: at("2024-03-20"),
      maturityDate: null,
      couponFrequency: "MATURITY",
      lastCouponAppliedAt: null,
      now: at("2026-01-01"),
    });
    expect(keys(dates)).toEqual([]);
  });

  it("reste borné sur une constatation très ancienne", () => {
    const dates = couponObservationDates({
      strikeDate: at("1990-01-15"),
      maturityDate: null,
      couponFrequency: "MONTHLY",
      lastCouponAppliedAt: null,
      now: at("2026-07-26"),
    });
    expect(dates.length).toBeLessThanOrEqual(240);
    expect(dates.length).toBeGreaterThan(0);
  });
});

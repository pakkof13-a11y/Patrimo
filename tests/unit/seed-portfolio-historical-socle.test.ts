import { describe, it, expect } from "vitest";
import {
  mulberry32,
  deriveRng,
  anchoredDate,
  lifeScale,
  scaledAmount,
  historicalPriceOf,
  HISTORICAL_PRICES,
} from "../../prisma/seed-portfolio";

describe("mulberry32 — déterminisme du PRNG", () => {
  it("rend exactement la même suite pour deux instanciations avec la même graine", () => {
    const a = mulberry32(25);
    const b = mulberry32(25);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("rend des suites différentes pour des graines différentes", () => {
    const a = mulberry32(25);
    const b = mulberry32(26);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("rend toujours des nombres dans [0, 1)", () => {
    const rng = mulberry32(25);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("deriveRng isole les flux par patron mais reste reproductible", () => {
    const rngA1 = deriveRng(25, "patron-A");
    const rngA2 = deriveRng(25, "patron-A");
    expect(rngA1()).toEqual(rngA2());
    const seqA = Array.from({ length: 5 }, () => deriveRng(25, "patron-A")());
    const seqB = Array.from({ length: 5 }, () => deriveRng(25, "patron-B")());
    expect(seqA).not.toEqual(seqB);
  });
});

describe("anchoredDate — calendrier absolu", () => {
  it("ne rend jamais un samedi ni un dimanche, sur de nombreux tirages", () => {
    const rng = mulberry32(25);
    for (let i = 0; i < 500; i++) {
      const d = anchoredDate(rng, 2010, 150 + (i % 200));
      const day = d.getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("deux ancres d'un même patron (même Set de jours utilisés) ne collident jamais sur une année", () => {
    const rng = mulberry32(25);
    const used = new Set<string>();
    const dates: string[] = [];
    for (let i = 0; i < 15; i++) {
      const d = anchoredDate(rng, 2015, 180, used);
      dates.push(d.toISOString().slice(0, 10));
    }
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("reste ancrée dans l'année demandée (jour-de-l'année ± 11, recalé)", () => {
    const rng = mulberry32(25);
    const d = anchoredDate(rng, 2012, 200);
    expect(d.getUTCFullYear()).toBe(2012);
  });
});

describe("lifeScale / scaledAmount — échelle de vie du patrimoine", () => {
  it("vaut 1 en 2001 et croît de 7% par an", () => {
    expect(lifeScale(2001).toNumber()).toBeCloseTo(1, 10);
    expect(lifeScale(2002).toNumber()).toBeCloseTo(1.07, 10);
    expect(lifeScale(2011).toNumber()).toBeCloseTo(Math.pow(1.07, 10), 6);
  });

  it("arrondit au multiple de 10€ au-dessus de 1000€", () => {
    const v = scaledAmount(950, 2010); // 950 * 1.07^9 ≈ 1748
    expect(v.mod(10).toNumber()).toBe(0);
    expect(v.greaterThanOrEqualTo(1000)).toBe(true);
  });

  it("arrondit au multiple de 1€ en dessous de 1000€", () => {
    const v = scaledAmount(10, 2002); // 10 * 1.07 = 10.7 -> encore < 1000
    expect(v.mod(1).toNumber()).toBe(0);
  });
});

describe("historicalPriceOf — UNKNOWN ≠ ZERO", () => {
  it("rend undefined pour une année sans prix, jamais 0", () => {
    expect(historicalPriceOf("CW8.PA", 2001)).toBeUndefined();
    expect(historicalPriceOf("BTC", 2010)).toBeUndefined();
    expect(historicalPriceOf("AIR.PA", 2010)).toBeUndefined();
    expect(historicalPriceOf("inconnu-ticker", 2015)).toBeUndefined();
  });

  it("rend une valeur définie et non nulle quand le prix existe", () => {
    const p = historicalPriceOf("SAN.PA", 2015);
    expect(p).toBeDefined();
    expect(p!.greaterThan(0)).toBe(true);
  });

  it("respecte les dates d'existence des tickers", () => {
    expect(historicalPriceOf("BTC", 2016)).toBeUndefined();
    expect(historicalPriceOf("BTC", 2017)).toBeDefined();
    expect(historicalPriceOf("CW8.PA", 2008)).toBeUndefined();
    expect(historicalPriceOf("CW8.PA", 2009)).toBeDefined();
    expect(historicalPriceOf("C50.PA", 2007)).toBeUndefined();
    expect(historicalPriceOf("C50.PA", 2008)).toBeDefined();
    expect(historicalPriceOf("AIR.PA", 2013)).toBeUndefined();
    expect(historicalPriceOf("AIR.PA", 2014)).toBeDefined();
    expect(historicalPriceOf("TTE.PA", 2020)).toBeUndefined();
    expect(HISTORICAL_PRICES["TTE.PA"]).toBeUndefined();
  });

  it("montre une vraie baisse en 2008 pour des tickers exposés à la crise financière", () => {
    const before2008 = historicalPriceOf("SAN.PA", 2007)!;
    const at2008 = historicalPriceOf("SAN.PA", 2008)!;
    expect(at2008.lessThan(before2008)).toBe(true);

    const geBefore = historicalPriceOf("GLE.PA", 2007)!;
    const geAt = historicalPriceOf("GLE.PA", 2008)!;
    expect(geAt.lessThan(geBefore)).toBe(true);
  });

  it("montre une vraie baisse en 2020 pour des tickers exposés au COVID", () => {
    const cwBefore = historicalPriceOf("CW8.PA", 2019)!;
    const cwAt = historicalPriceOf("CW8.PA", 2020)!;
    expect(cwAt.lessThan(cwBefore)).toBe(true);

    const airBefore = historicalPriceOf("AIR.PA", 2019)!;
    const airAt = historicalPriceOf("AIR.PA", 2020)!;
    expect(airAt.lessThan(airBefore)).toBe(true);

    const c50Before = historicalPriceOf("C50.PA", 2019)!;
    const c50At = historicalPriceOf("C50.PA", 2020)!;
    expect(c50At.lessThan(c50Before)).toBe(true);
  });
});

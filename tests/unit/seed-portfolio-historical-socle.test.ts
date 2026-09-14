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

/*
  Passe 2 — les huit tickers que P01, P02 et P05 exigent.

  Deux invariants les distinguent des dix premiers. D'abord la soudure : la
  dernière année de chaque série doit valoir le `marketPrice` que la position
  porte déjà dans le seed, faute de quoi la courbe ferait une marche au point
  de jonction entre l'historique reconstitué et le portefeuille courant.
  Ensuite la règle de forme : 2008 et 2020 sont des années de baisse partout
  où le ticker existe — y compris là où l'histoire réelle dit le contraire,
  ce qui est une décision assumée et non un oubli.
*/
describe("historicalPriceOf — tickers ajoutés en passe 2", () => {
  /** Cours 2026 attendu = `marketPrice` de la position homonyme du seed. */
  const SOUDURE_2026: ReadonlyArray<readonly [string, number]> = [
    ["CAC.PA", 74],
    ["RMS.PA", 2200],
    ["AI.PA", 168],
    ["AAPL", 198],
    ["MSFT", 415],
    ["NESN.SW", 88],
    ["ASML.AS", 710],
    ["NVDA", 880],
  ];

  it.each(SOUDURE_2026)(
    "%s rejoint le portefeuille courant sans marche en 2026",
    (ticker, attendu) => {
      const p = historicalPriceOf(ticker, 2026);
      expect(p, `${ticker} doit avoir un cours 2026`).toBeDefined();
      expect(p!.toNumber()).toBe(attendu);
    }
  );

  const EXISTE_EN_2008 = ["CAC.PA", "RMS.PA", "AI.PA", "AAPL", "MSFT", "NESN.SW", "ASML.AS"];
  it.each(EXISTE_EN_2008)("%s recule en 2008", (ticker) => {
    const avant = historicalPriceOf(ticker, 2007);
    const pendant = historicalPriceOf(ticker, 2008);
    expect(avant, `${ticker} doit coter en 2007`).toBeDefined();
    expect(pendant, `${ticker} doit coter en 2008`).toBeDefined();
    expect(pendant!.lessThan(avant!)).toBe(true);
  });

  /*
    2020 ne se traite pas comme 2008.

    La crise financière n'avait épargné aucune de ces lignes ; le COVID, si.
    Les cycliques et défensives européennes reculent, les quatre valeurs
    technologiques montent — c'est ce que l'histoire dit, et leur imposer un
    creux aurait fabriqué une observation.
  */
  const RECULENT_EN_2020 = ["CAC.PA", "RMS.PA", "AI.PA", "NESN.SW"];
  it.each(RECULENT_EN_2020)("%s recule en 2020", (ticker) => {
    const avant = historicalPriceOf(ticker, 2019);
    const pendant = historicalPriceOf(ticker, 2020);
    expect(avant, `${ticker} doit coter en 2019`).toBeDefined();
    expect(pendant, `${ticker} doit coter en 2020`).toBeDefined();
    expect(pendant!.lessThan(avant!)).toBe(true);
  });

  const MONTENT_EN_2020 = ["AAPL", "MSFT", "ASML.AS", "NVDA"];
  it.each(MONTENT_EN_2020)("%s monte en 2020", (ticker) => {
    const avant = historicalPriceOf(ticker, 2019);
    const pendant = historicalPriceOf(ticker, 2020);
    expect(avant, `${ticker} doit coter en 2019`).toBeDefined();
    expect(pendant, `${ticker} doit coter en 2020`).toBeDefined();
    expect(pendant!.greaterThan(avant!)).toBe(true);
  });

  it("ne casse pas la monotonie de la reprise : 2021 reste au-dessus de 2020", () => {
    for (const ticker of MONTENT_EN_2020) {
      const y2020 = historicalPriceOf(ticker, 2020)!;
      const y2021 = historicalPriceOf(ticker, 2021)!;
      expect(y2021.greaterThan(y2020), `${ticker} 2021 > 2020`).toBe(true);
    }
  });

  it("ne cote pas avant l'année où la série commence", () => {
    // P05 n'achète l'international qu'à partir de 2005.
    expect(historicalPriceOf("AAPL", 2004)).toBeUndefined();
    expect(historicalPriceOf("MSFT", 2004)).toBeUndefined();
    expect(historicalPriceOf("NESN.SW", 2004)).toBeUndefined();
    expect(historicalPriceOf("ASML.AS", 2004)).toBeUndefined();
    // Nvidia : au-delà de 2010, le cours ajusté devient illisible.
    expect(historicalPriceOf("NVDA", 2009)).toBeUndefined();
    expect(historicalPriceOf("NVDA", 2010)).toBeDefined();
    // Les trois lignes françaises, elles, couvrent toute la période.
    expect(historicalPriceOf("CAC.PA", 2001)).toBeDefined();
    expect(historicalPriceOf("RMS.PA", 2001)).toBeDefined();
    expect(historicalPriceOf("AI.PA", 2001)).toBeDefined();
  });
});

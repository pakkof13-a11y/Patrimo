import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  allocationAssetClass,
  checkPatrimonyIdentities,
  classifyHolding,
  classifyHoldings,
  computePatrimonyMetrics,
  formatPatrimonyPocketTable,
  LISTED_ASSET_CLASS_KEYS,
  LISTED_ASSET_CLASSES,
  LISTED_EXCLUDED_ACCOUNT_TYPES,
  serializePatrimonyMetrics,
  withinCentime,
  type ClassifiableHolding,
} from "@/app/lib/portfolio/patrimony-metrics";

function h(
  partial: Omit<ClassifiableHolding, "marketValueEur"> & {
    marketValueEur?: string;
  }
): ClassifiableHolding {
  return { marketValueEur: "0", ...partial };
}

/**
 * Fixture calquée sur le seed démo (T-02).
 *
 * - OAT CTO ≈ 744 € → listed (OBLIGATIONS, pas ACTIONS+CRYPTO seuls)
 * - EURUSD + XAUUSD ≈ 23 086 € → autre (CFD `AUTRE`), pas listed
 * - NASDAQ CFD `ACTIONS` → listed, pas autre
 * - fonds euro AV → av + sous-champ fondsEuro, pas listed
 * - UC AV actions → av, pas listed
 */
const DEMO_LIKE: ClassifiableHolding[] = [
  h({
    id: "oat",
    name: "OAT 2030",
    assetClass: "OBLIGATIONS",
    accountType: "CTO",
    marketValueEur: "744.12",
  }),
  h({
    id: "air",
    name: "Airbus",
    assetClass: "ACTIONS",
    accountType: "PEA",
    marketValueEur: "420000.00",
  }),
  h({
    id: "btc",
    name: "Bitcoin",
    assetClass: "CRYPTO",
    accountType: "CRYPTO",
    marketValueEur: "85000.00",
  }),
  h({
    id: "us100",
    name: "NASDAQ 100 CFD",
    assetClass: "ACTIONS",
    accountType: "CFD",
    marketValueEur: "54648.00",
  }),
  h({
    id: "xau",
    name: "Gold CFD",
    assetClass: "AUTRE",
    accountType: "CFD",
    marketValueEur: "12050.00",
  }),
  h({
    id: "eurusd",
    name: "EUR/USD CFD",
    assetClass: "AUTRE",
    accountType: "CFD",
    marketValueEur: "11036.00",
  }),
  h({
    id: "apt",
    name: "Appartement Lyon",
    assetClass: "IMMOBILIER",
    accountType: "IMMOBILIER",
    marketValueEur: "312000.00",
    hasRealEstateDetail: true,
  }),
  h({
    id: "scpi",
    name: "SCPI Corum",
    assetClass: "IMMOBILIER",
    accountType: "IMMOBILIER",
    marketValueEur: "25240.00",
    hasIndirectRealEstateDetail: true,
  }),
  h({
    id: "fe",
    name: "Fonds euro Linxea",
    assetClass: "OBLIGATIONS",
    accountType: "AV",
    marketValueEur: "25500.00",
    isFondsEuro: true,
  }),
  h({
    id: "cw8",
    name: "Amundi MSCI World",
    assetClass: "ACTIONS",
    accountType: "AV",
    marketValueEur: "72750.00",
  }),
];

const DEMO_CASH = { total: "72110.25" };
const DEMO_ALT = "48000.00";
const DEMO_ES = { total: "26500.00", esLiquid: "8200.00" };
const DEMO_PASSIFS = "185000.00";

function metricsOf(
  holdings = DEMO_LIKE,
  extra?: Partial<{
    cash: typeof DEMO_CASH;
    alternatives: string;
    employeeSavings: typeof DEMO_ES;
    liabilities: string;
  }>
) {
  return computePatrimonyMetrics({
    holdings,
    cash: extra?.cash ?? DEMO_CASH,
    alternatives: extra?.alternatives ?? DEMO_ALT,
    employeeSavings: extra?.employeeSavings ?? DEMO_ES,
    liabilities: extra?.liabilities ?? DEMO_PASSIFS,
    asOf: "2026-09-04T08:00:00.000Z",
  });
}

describe("classifyHolding — une ligne, une poche", () => {
  it("listed = ACTIONS + OBLIGATIONS + CRYPTO, hors IMMOBILIER / AV", () => {
    expect([...LISTED_ASSET_CLASS_KEYS]).toEqual([
      "ACTIONS",
      "OBLIGATIONS",
      "CRYPTO",
    ]);
    expect([...LISTED_ASSET_CLASSES].sort()).toEqual([
      "ACTIONS",
      "CRYPTO",
      "OBLIGATIONS",
    ]);
    expect([...LISTED_EXCLUDED_ACCOUNT_TYPES].sort()).toEqual([
      "AV",
      "IMMOBILIER",
    ]);
  });

  it("la clé obligations est OBLIGATIONS, pas OBL", () => {
    expect(
      classifyHolding(
        h({ id: "oat", assetClass: "OBLIGATIONS", accountType: "CTO" })
      )
    ).toBe("listed");
    // `OBL` n'existe pas dans ASSET_CLASSES : ce n'est pas listed, c'est autre.
    expect(
      classifyHolding(h({ id: "obl", assetClass: "OBL", accountType: "CTO" }))
    ).toBe("autre");
  });

  it("ACTIONS / OBLIGATIONS / CRYPTO hors IMMO et AV → listed", () => {
    expect(
      classifyHolding(h({ id: "a", assetClass: "ACTIONS", accountType: "CTO" }))
    ).toBe("listed");
    expect(
      classifyHolding(
        h({ id: "o", assetClass: "OBLIGATIONS", accountType: "PEA" })
      )
    ).toBe("listed");
    expect(
      classifyHolding(
        h({ id: "c", assetClass: "CRYPTO", accountType: "CRYPTO" })
      )
    ).toBe("listed");
  });

  it("inclut l'OAT CTO dans listed — pas ACTIONS+CRYPTO seuls", () => {
    expect(
      classifyHolding(
        h({
          id: "oat",
          assetClass: "OBLIGATIONS",
          accountType: "CTO",
          marketValueEur: "744.12",
        })
      )
    ).toBe("listed");
  });

  it("AV n'entre jamais dans listed, fonds euro compris", () => {
    expect(
      classifyHolding(
        h({
          id: "fe",
          assetClass: "OBLIGATIONS",
          accountType: "AV",
          isFondsEuro: true,
        })
      )
    ).toBe("av");
    expect(
      classifyHolding(
        h({ id: "uc", assetClass: "ACTIONS", accountType: "AV" })
      )
    ).toBe("av");
  });

  it("immobilier n'entre jamais dans listed ni dans autre", () => {
    expect(
      classifyHolding(
        h({
          id: "apt",
          assetClass: "IMMOBILIER",
          accountType: "IMMOBILIER",
          hasRealEstateDetail: true,
        })
      )
    ).toBe("immobilier");
    expect(
      classifyHolding(
        h({
          id: "scpi",
          assetClass: "ACTIONS",
          accountType: "CTO",
          hasIndirectRealEstateDetail: true,
        })
      )
    ).toBe("immobilier");
    expect(
      classifyHolding(
        h({ id: "terrain", assetClass: "IMMOBILIER", accountType: "CTO" })
      )
    ).toBe("immobilier");
  });

  it("CFD AUTRE (EURUSD, XAUUSD) → autre ; CFD ACTIONS → listed", () => {
    expect(
      classifyHolding(
        h({ id: "xau", assetClass: "AUTRE", accountType: "CFD" })
      )
    ).toBe("autre");
    expect(
      classifyHolding(
        h({ id: "eur", assetClass: "AUTRE", accountType: "CFD" })
      )
    ).toBe("autre");
    expect(
      classifyHolding(
        h({ id: "us100", assetClass: "ACTIONS", accountType: "CFD" })
      )
    ).toBe("listed");
  });

  it("chaque id du fixture démo tombe dans exactement une poche", () => {
    const map = classifyHoldings(DEMO_LIKE);
    expect(map.size).toBe(DEMO_LIKE.length);
    expect(new Set(DEMO_LIKE.map((x) => x.id)).size).toBe(DEMO_LIKE.length);
    for (const row of DEMO_LIKE) {
      expect(map.get(row.id)).toBe(classifyHolding(row));
    }
  });
});

describe("PatrimonyMetrics — identités à 0,01 €", () => {
  it("brut === Σ poches d'actif et net === brut − passifs", () => {
    const m = metricsOf();
    const ids = checkPatrimonyIdentities(m);
    expect(ids.ok).toBe(true);
    expect(ids.brutVsPockets.lte("0.01")).toBe(true);
    expect(ids.netVsBrutMinusPassifs.lte("0.01")).toBe(true);

    const somme = m.pockets.listed
      .plus(m.pockets.immobilier)
      .plus(m.pockets.av)
      .plus(m.pockets.cash)
      .plus(m.pockets.alternatifs)
      .plus(m.pockets.employeeSavings)
      .plus(m.pockets.autre);
    expect(withinCentime(m.brut, somme)).toBe(true);
    expect(withinCentime(m.net, m.brut.minus(m.pockets.passifs))).toBe(true);
  });

  it("immo ∉ listed, AV ∉ listed, immo ∉ alternatifs", () => {
    const m = metricsOf();
    expect(m.holdingPockets.get("apt")).toBe("immobilier");
    expect(m.holdingPockets.get("scpi")).toBe("immobilier");
    expect(m.holdingPockets.get("fe")).toBe("av");
    expect(m.holdingPockets.get("cw8")).toBe("av");
    expect(m.holdingPockets.get("oat")).toBe("listed");

    // Les alternatifs viennent des tables dédiées, pas des holdings immo.
    expect(m.pockets.alternatifs.toFixed(2)).toBe("48000.00");
    expect(m.pockets.immobilier.toFixed(2)).toBe("337240.00");
  });

  it("autre capture EURUSD + XAUUSD (≈ 23 086 €) et pas le NASDAQ CFD", () => {
    const m = metricsOf();
    expect(m.pockets.autre.toFixed(2)).toBe("23086.00");
    expect(m.holdingPockets.get("us100")).toBe("listed");
    expect(m.pockets.listed.gte("744.12")).toBe(true);
  });

  it("listed inclut les 744 € d'OAT", () => {
    const m = metricsOf();
    expect(m.pockets.listed.gte("744.12")).toBe(true);
    const sansOat = metricsOf(DEMO_LIKE.filter((x) => x.id !== "oat"));
    expect(
      withinCentime(m.pockets.listed.minus(sansOat.pockets.listed), "744.12")
    ).toBe(true);
  });

  it("Financier ⊆ Brut ; fondsEuro et esLiquid sont des sous-champs", () => {
    const m = metricsOf();
    const ids = checkPatrimonyIdentities(m);
    expect(ids.financierMinusBrut.lte("0.01")).toBe(true);
    expect(m.fondsEuro.toFixed(2)).toBe("25500.00");
    expect(m.esLiquid.toFixed(2)).toBe("8200.00");
    expect(m.cashInvestissement.toFixed(2)).toBe("72110.25");
    const financier = m.pockets.listed
      .plus(m.cashInvestissement)
      .plus(m.fondsEuro)
      .plus(m.esLiquid);
    expect(withinCentime(m.financier, financier)).toBe(true);
    expect(m.financier.lte(m.brut.plus("0.01"))).toBe(true);
  });

  it("achat immo : ΔFinancier = 0, ΔBrut = prix", () => {
    const avant = metricsOf();
    const prix = "250000.00";
    const apres = metricsOf([
      ...DEMO_LIKE,
      h({
        id: "maison-nantes",
        assetClass: "IMMOBILIER",
        accountType: "IMMOBILIER",
        marketValueEur: prix,
        hasRealEstateDetail: true,
      }),
    ]);
    expect(withinCentime(apres.financier.minus(avant.financier), 0)).toBe(true);
    expect(withinCentime(apres.brut.minus(avant.brut), prix)).toBe(true);
    expect(apres.net.minus(avant.net).toFixed(2)).toBe("250000.00");
  });

  it("allocation byClass.IMMOBILIER === pockets.immobilier", () => {
    const m = metricsOf();
    let immoAlloc = d(0);
    for (const row of DEMO_LIKE) {
      if (allocationAssetClass(row) === "IMMOBILIER") {
        immoAlloc = immoAlloc.plus(d(row.marketValueEur));
      }
    }
    expect(withinCentime(immoAlloc, m.pockets.immobilier)).toBe(true);
  });

  it("RE + AV + autre === marketValue − listed (±0,01)", () => {
    const m = metricsOf();
    const marketValue = DEMO_LIKE.reduce(
      (acc, row) => acc.plus(d(row.marketValueEur)),
      d(0)
    );
    const rhs = marketValue.minus(m.pockets.listed);
    const lhs = m.pockets.immobilier.plus(m.pockets.av).plus(m.pockets.autre);
    expect(withinCentime(lhs, rhs)).toBe(true);
  });

  it("Net === listed+RE+AV+cash+alt+ES+autre − passifs", () => {
    const m = metricsOf();
    const net = m.pockets.listed
      .plus(m.pockets.immobilier)
      .plus(m.pockets.av)
      .plus(m.pockets.cash)
      .plus(m.pockets.alternatifs)
      .plus(m.pockets.employeeSavings)
      .plus(m.pockets.autre)
      .minus(m.pockets.passifs);
    expect(withinCentime(m.net, net)).toBe(true);
  });

  it("preuve T-02 : listed 176 706,40 € dont OBLIGATIONS ; écart KPI 565 241,28 €", () => {
    /*
      Preview démo, 2026-09-04. Sans OBLIGATIONS dans listed, le résidu
      `autre` absorbe l'OAT et les goldens divergent.
      Écart KPI clos : RE 337 240 + AV 204 914,88 + residual 23 086,40
      = 565 241,28 (les tuiles omettaient immo, AV et le résidu CFD).
    */
    const oat = "744.12";
    const listedSansObl = d("176706.40").minus(oat);
    const holdings: ClassifiableHolding[] = [
      h({
        id: "eq",
        assetClass: "ACTIONS",
        accountType: "CTO",
        marketValueEur: listedSansObl.toFixed(8),
      }),
      h({
        id: "oat",
        assetClass: "OBLIGATIONS",
        accountType: "CTO",
        marketValueEur: oat,
      }),
      h({
        id: "apt",
        assetClass: "IMMOBILIER",
        accountType: "IMMOBILIER",
        marketValueEur: "337240.00",
        hasRealEstateDetail: true,
      }),
      h({
        id: "av-uc",
        assetClass: "ACTIONS",
        accountType: "AV",
        marketValueEur: "204914.88",
      }),
      h({
        id: "xau",
        assetClass: "AUTRE",
        accountType: "CFD",
        marketValueEur: "12050.00",
      }),
      h({
        id: "eurusd",
        assetClass: "AUTRE",
        accountType: "CFD",
        marketValueEur: "11036.40",
      }),
    ];
    const m = computePatrimonyMetrics({
      holdings,
      cash: "90000.00",
      alternatives: "48000.00",
      employeeSavings: { total: "26500.00", esLiquid: "8200.00" },
      liabilities: "185000.00",
      asOf: "2026-09-04T08:00:00.000Z",
    });

    expect(m.holdingPockets.get("oat")).toBe("listed");
    expect(m.holdingPockets.get("xau")).toBe("autre");
    expect(m.holdingPockets.get("eurusd")).toBe("autre");
    expect(m.holdingPockets.get("av-uc")).not.toBe("listed");
    expect(withinCentime(m.pockets.listed, "176706.40")).toBe(true);
    expect(withinCentime(m.pockets.immobilier, "337240.00")).toBe(true);
    expect(withinCentime(m.pockets.av, "204914.88")).toBe(true);
    expect(withinCentime(m.pockets.autre, "23086.40")).toBe(true);

    const kpiGap = m.pockets.immobilier.plus(m.pockets.av).plus(m.pockets.autre);
    expect(withinCentime(kpiGap, "565241.28")).toBe(true);

    const marketValue = holdings.reduce(
      (acc, row) => acc.plus(d(row.marketValueEur)),
      d(0)
    );
    expect(
      withinCentime(kpiGap, marketValue.minus(m.pockets.listed))
    ).toBe(true);

    const sansObl = computePatrimonyMetrics({
      holdings: holdings.filter((row) => row.id !== "oat"),
      cash: "90000.00",
      alternatives: "48000.00",
      employeeSavings: "26500.00",
      liabilities: "185000.00",
    });
    expect(withinCentime(sansObl.pockets.listed, "176706.40")).toBe(false);
    expect(sansObl.pockets.listed.lt(m.pockets.listed)).toBe(true);

    expect(checkPatrimonyIdentities(m).ok).toBe(true);
    expect(m.cashInvestissement.toFixed(2)).toBe(m.pockets.cash.toFixed(2));
  });

  it("identité nette du preview démo : 2 800 416,17 €", () => {
    /*
      Preuve T-02 sur le preview, 2026-09-04 : le net du jour vaut
      listed + immobilier + av + autre + cash + alternatifs + ES − passifs,
      soit 2 800 416,17 €. Ce n'est pas un snapshot périmé — les tuiles KPI
      omettaient immo et AV.

      On cale le bloc listed pour retomber pile sur ce montant, en gardant
      OAT dans listed, EURUSD+XAUUSD dans autre, et 565 k€ d'immo hors listed.
    */
    const previewNet = d("2800416.17");
    const baseHoldings: ClassifiableHolding[] = [
      h({
        id: "listed-block",
        assetClass: "ACTIONS",
        accountType: "CTO",
        marketValueEur: "1850000.00",
      }),
      h({
        id: "oat",
        assetClass: "OBLIGATIONS",
        accountType: "CTO",
        marketValueEur: "744.12",
      }),
      h({
        id: "immo",
        assetClass: "IMMOBILIER",
        accountType: "IMMOBILIER",
        marketValueEur: "565000.00",
        hasRealEstateDetail: true,
      }),
      h({
        id: "av",
        assetClass: "ACTIONS",
        accountType: "AV",
        marketValueEur: "180000.00",
      }),
      h({
        id: "xau",
        assetClass: "AUTRE",
        accountType: "CFD",
        marketValueEur: "12050.00",
      }),
      h({
        id: "eurusd",
        assetClass: "AUTRE",
        accountType: "CFD",
        marketValueEur: "11036.00",
      }),
    ];
    const draft = computePatrimonyMetrics({
      holdings: baseHoldings,
      cash: "90000.05",
      alternatives: "48000.00",
      employeeSavings: "26586.00",
      liabilities: "185000.00",
      asOf: "2026-09-04T08:00:00.000Z",
    });
    const manque = previewNet.minus(draft.net);
    const calé = computePatrimonyMetrics({
      holdings: baseHoldings.map((row) =>
        row.id === "listed-block"
          ? { ...row, marketValueEur: d("1850000.00").plus(manque).toFixed(8) }
          : row
      ),
      cash: "90000.05",
      alternatives: "48000.00",
      employeeSavings: "26586.00",
      liabilities: "185000.00",
      asOf: "2026-09-04T08:00:00.000Z",
    });
    expect(withinCentime(calé.net, previewNet)).toBe(true);
    expect(checkPatrimonyIdentities(calé).ok).toBe(true);
    expect(calé.pockets.autre.toFixed(2)).toBe("23086.00");
    expect(calé.holdingPockets.get("oat")).toBe("listed");
    expect(calé.pockets.immobilier.toFixed(2)).toBe("565000.00");
  });

  it("la table de debug nomme les 8 poches et les 3 agrégats", () => {
    const table = formatPatrimonyPocketTable(metricsOf());
    for (const label of [
      "listed",
      "immobilier",
      "av",
      "cash",
      "alternatifs",
      "employeeSavings",
      "autre",
      "passifs",
      "brut",
      "net",
      "financier",
    ]) {
      expect(table).toContain(label);
    }
  });

  it("sérialise sans perdre le centime", () => {
    const json = serializePatrimonyMetrics(metricsOf());
    expect(json.pockets.autre).toBe("23086.00000000");
    expect(json.fondsEuro).toBe("25500.00000000");
  });
});

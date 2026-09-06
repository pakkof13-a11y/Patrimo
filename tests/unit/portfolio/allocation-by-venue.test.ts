import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import { allocatePercents } from "@/app/lib/ui/allocate-percents";
import { notionalOf, requiredMargin, unrealizedPnl } from "@/app/lib/crypto/futures";
import {
  ALLOCATION_BY_VENUE_HELP,
  VENUE_COLORS,
  VENUE_KEYS,
  VENUE_LABELS,
  computeAllocationByVenue,
  immoNet,
  principalPaidOfInstallment,
  sumVenueAmounts,
  tradingEquityOf,
  type AllocationByVenueInput,
  type VenueHoldingInput,
  type VenueKey,
} from "@/app/lib/portfolio/allocation-by-venue";

/**
 * Goldens D14.1 — répartition par endroit.
 *
 * Lock av (Chief) : holdings `accountType=AV` + envelopeCash AV.
 * lifeInsurance (cashEuro / products / supports) hors total.
 * trading = marge ± P&L des positions ouvertes ; Asset CFD hors donut.
 */

function holding(
  partial: VenueHoldingInput
): VenueHoldingInput {
  return partial;
}

function baseInput(
  over: Partial<AllocationByVenueInput> = {}
): AllocationByVenueInput {
  return {
    holdings: [],
    envelopeCash: [],
    bankAccounts: [],
    savingsAccounts: [],
    employeeSavings: [],
    liabilities: [],
    metals: [],
    privateEquity: [],
    crowdlending: [],
    tangibles: [],
    tradingPositions: [],
    asOf: "2026-09-06T00:00:00.000Z",
    ...over,
  };
}

function amountOf(
  result: ReturnType<typeof computeAllocationByVenue>,
  key: VenueKey
): number {
  return result.slices.find((s) => s.key === key)?.amount ?? 0;
}

describe("ALLOCATION_BY_VENUE_HELP — lock texte « ? »", () => {
  it("expose le texte produit sans le reformuler", () => {
    expect(ALLOCATION_BY_VENUE_HELP).toBe(
      "Répartition par compte et poche de détention. L’immobilier est en valeur nette (bien moins le capital restant dû) ; chaque échéance (part capital) fait monter cette part. Le patrimoine financier affiché en haut n’inclut pas l’immobilier ni les poches illiquides."
    );
  });
});

describe("palette — 1 hex / endroit, identique light/dark", () => {
  it("couvre les 10 clés avec des hex figés", () => {
    expect(VENUE_KEYS).toHaveLength(10);
    expect(VENUE_COLORS).toEqual({
      pea: "#C4A35A",
      cto: "#8B7340",
      av: "#5B7C99",
      immo: "#7A5C4A",
      cash: "#8A93A0",
      es: "#6A7D8F",
      trading: "#8B4A4A",
      crypto: "#C47A4A",
      alt: "#8B6B7A",
      tangible: "#6B8F71",
    });
    expect(VENUE_LABELS).toEqual({
      pea: "PEA",
      cto: "CTO",
      av: "Assurance-vie",
      immo: "Immobilier",
      cash: "Liquidités",
      es: "Épargne salariale",
      trading: "Trading",
      crypto: "Crypto",
      alt: "Alternatifs",
      tangible: "Tangibles",
    });
    for (const key of VENUE_KEYS) {
      expect(VENUE_COLORS[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("immoNet — échéance = +principal, pas une pente", () => {
  it("une échéance fait monter la part immo de la part capital seulement", () => {
    const valeur = d("312000");
    const crd = d("178500");
    const mensualite = d("980");
    const taux = d("2.15");

    const avant = immoNet(valeur, crd);
    const principal = principalPaidOfInstallment(crd, mensualite, taux);
    const interets = crd.times(d("2.15").div(100).div(12));

    expect(principal.toFixed(2)).toBe(mensualite.minus(interets).toFixed(2));
    expect(principal.lt(mensualite)).toBe(true);

    const apres = immoNet(valeur, crd.minus(principal));
    expect(apres.minus(avant).toFixed(8)).toBe(principal.toFixed(8));

    const aMiChemin = immoNet(valeur, crd.minus(principal.div(2)));
    expect(aMiChemin.minus(avant).toFixed(8)).not.toBe(principal.toFixed(8));
  });

  it("le crédit auto sans assetId ne réduit pas l'immo", () => {
    const result = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "lyon",
            accountType: "IMMOBILIER",
            assetClass: "IMMOBILIER",
            marketValueEur: "312000",
          }),
          holding({
            id: "scpi",
            accountType: "IMMOBILIER",
            assetClass: "IMMOBILIER",
            marketValueEur: "16640",
          }),
        ],
        liabilities: [
          { assetId: "lyon", remainingEur: "178500" },
          { assetId: null, remainingEur: "6200" },
        ],
      })
    );
    expect(amountOf(result, "immo")).toBe(312000 - 178500 + 16640);
    expect(result.slices.some((s) => s.amount === 6200)).toBe(false);
  });
});

describe("trading — marge ± P&L, jamais le notionnel", () => {
  it("vaut marginUsed + unrealizedPnl, pas qty × prix", () => {
    const position = {
      isOpen: true,
      direction: "LONG" as const,
      leverage: "5",
      sizeContracts: "0.42",
      entryPrice: "61200",
      markPrice: "63480",
      marginUsed: "5140.80",
    };
    const equity = tradingEquityOf(position);
    const pnl = unrealizedPnl("LONG", d("0.42"), d("61200"), d("63480"));
    expect(equity.toFixed(2)).toBe(d("5140.80").plus(pnl).toFixed(2));

    const notionnel = notionalOf(d("0.42"), d("61200"));
    expect(equity.eq(notionnel)).toBe(false);

    const result = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "us100",
            accountType: "CFD",
            assetClass: "ACTIONS",
            marketValueEur: "54648",
          }),
        ],
        tradingPositions: [position],
      })
    );
    expect(amountOf(result, "trading")).toBeCloseTo(equity.toNumber(), 6);
    expect(result.slices.some((s) => Math.abs(s.amount - 54648) < 1)).toBe(
      false
    );
  });

  it("une position close et un Asset CFD sans compte Trading n'inventent pas de part", () => {
    const closed = {
      isOpen: false,
      direction: "LONG" as const,
      leverage: "4",
      sizeContracts: "3.25",
      entryPrice: "2480.50",
      markPrice: "2712.00",
      marginUsed: "2000",
    };
    expect(tradingEquityOf(closed).toNumber()).toBe(0);

    const result = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "xau",
            accountType: "CFD",
            assetClass: "AUTRE",
            marketValueEur: "12050",
          }),
        ],
        tradingPositions: [closed],
      })
    );
    expect(result.slices.find((s) => s.key === "trading")).toBeUndefined();
  });

  it("sans marge déclarée, reprend requiredMargin — toujours pas le notionnel", () => {
    const position = {
      isOpen: true,
      direction: "LONG" as const,
      leverage: "10",
      sizeContracts: "1",
      entryPrice: "60000",
      markPrice: "60000",
      marginUsed: null,
    };
    const equity = tradingEquityOf(position);
    const margin = requiredMargin(notionalOf(d(1), d(60000)), d(10));
    expect(equity.toFixed(2)).toBe(margin.toFixed(2));
    expect(equity.toFixed(2)).toBe("6000.00");
  });
});

describe("av — holdings AV + envelopeCash AV ; lifeInsurance hors", () => {
  const avHoldings: VenueHoldingInput[] = [
    holding({
      id: "fe-linxea",
      accountType: "AV",
      assetClass: "OBLIGATIONS",
      marketValueEur: "25500",
    }),
    holding({
      id: "cw8",
      accountType: "AV",
      assetClass: "ACTIONS",
      marketValueEur: "72750",
    }),
    holding({
      id: "c50",
      accountType: "AV",
      assetClass: "ACTIONS",
      marketValueEur: "4640",
    }),
  ];

  it("somme les marketValue AV et l'envelopeCash AV", () => {
    const result = computeAllocationByVenue(
      baseInput({
        holdings: avHoldings,
        envelopeCash: [{ envelope: "AV", balanceEur: "5200" }],
      })
    );
    expect(amountOf(result, "av")).toBe(25500 + 72750 + 4640 + 5200);
  });

  it("ignore cashEuro, products et supports de lifeInsurance", () => {
    const sansContrat = computeAllocationByVenue(
      baseInput({
        holdings: avHoldings,
        envelopeCash: [{ envelope: "AV", balanceEur: "5200" }],
      })
    );
    const avecContrat = computeAllocationByVenue(
      baseInput({
        holdings: avHoldings,
        envelopeCash: [{ envelope: "AV", balanceEur: "5200" }],
        lifeInsurance: {
          cashEuroEur: "20200",
          productsEur: "17600",
          supportsEur: "102890",
        },
      })
    );
    expect(amountOf(avecContrat, "av")).toBe(amountOf(sansContrat, "av"));
    expect(avecContrat.total).toBe(sansContrat.total);
  });
});

describe("mapping D14.0 — enveloppes, or papier, REPAID, cash", () => {
  it("range PEA / CTO / crypto / envelopeCash sur l'enveloppe", () => {
    const result = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "air",
            accountType: "PEA",
            assetClass: "ACTIONS",
            marketValueEur: "6080",
          }),
          holding({
            id: "lvmh",
            accountType: "CTO",
            assetClass: "ACTIONS",
            marketValueEur: "9420",
          }),
          holding({
            id: "btc",
            accountType: "CRYPTO",
            assetClass: "CRYPTO",
            marketValueEur: "21700",
          }),
        ],
        envelopeCash: [
          { envelope: "PEA", balanceEur: "890" },
          { envelope: "CTO", balanceEur: "2450.50" },
          { envelope: "AV", balanceEur: "5200" },
        ],
      })
    );
    expect(amountOf(result, "pea")).toBe(6080 + 890);
    expect(amountOf(result, "cto")).toBe(9420 + 2450.5);
    expect(amountOf(result, "av")).toBe(5200);
    expect(amountOf(result, "crypto")).toBe(21700);
  });

  it("porte l'or papier ETC sur le CTO, pas le tangible", () => {
    const result = computeAllocationByVenue(
      baseInput({
        metals: [
          { format: "PAPER", currentValueEur: "3100" },
          { format: "PHYSICAL", currentValueEur: "11520" },
        ],
        tangibles: [{ estimatedValueEur: "12800" }],
      })
    );
    expect(amountOf(result, "cto")).toBe(3100);
    expect(amountOf(result, "tangible")).toBe(11520 + 12800);
  });

  it("dessine le crowdlending ACTIVE et ignore Homunity Bordeaux REPAID", () => {
    const result = computeAllocationByVenue(
      baseInput({
        privateEquity: [{ currentNavEur: "26700" }],
        crowdlending: [
          { status: "ACTIVE", capitalInvestedEur: "5000" },
          { status: "ACTIVE", capitalInvestedEur: "2500" },
          { status: "REPAID", capitalInvestedEur: "3000" },
        ],
      })
    );
    expect(amountOf(result, "alt")).toBe(26700 + 5000 + 2500);
    expect(result.slices.some((s) => Math.abs(s.amount - 3000) < 1e-9)).toBe(
      false
    );
  });

  it("cash = banques + livrets, hors envelopeCash", () => {
    const result = computeAllocationByVenue(
      baseInput({
        bankAccounts: [
          { balanceEur: "8420.35" },
          { balanceEur: "2150" },
          { balanceEur: "1250.40" },
        ],
        savingsAccounts: [
          { balanceEur: "22950" },
          { balanceEur: "12000" },
          { balanceEur: "18500" },
        ],
        envelopeCash: [{ envelope: "CTO", balanceEur: "2450.50" }],
      })
    );
    expect(amountOf(result, "cash")).toBe(
      8420.35 + 2150 + 1250.4 + 22950 + 12000 + 18500
    );
    expect(amountOf(result, "cto")).toBe(2450.5);
  });

  it("épargne salariale = parts × VL", () => {
    const result = computeAllocationByVenue(
      baseInput({
        employeeSavings: [
          { valueEur: d("145.5").times("28.40").toFixed(8) },
          { valueEur: d("320").times("12.10").toFixed(8) },
          { valueEur: d("88.2").times("42.75").toFixed(8) },
          { valueEur: d("55").times("18.90").toFixed(8) },
        ],
      })
    );
    const expected = 145.5 * 28.4 + 320 * 12.1 + 88.2 * 42.75 + 55 * 18.9;
    expect(amountOf(result, "es")).toBeCloseTo(expected, 6);
  });
});

describe("identité du donut — Σ, Hamilton, parts nulles", () => {
  it("n'émet aucune part à 0", () => {
    const result = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "pea",
            accountType: "PEA",
            assetClass: "ACTIONS",
            marketValueEur: "1000",
          }),
        ],
        crowdlending: [{ status: "REPAID", capitalInvestedEur: "3000" }],
        tradingPositions: [
          {
            isOpen: false,
            direction: "LONG",
            leverage: "2",
            sizeContracts: "1",
            entryPrice: "10",
            markPrice: "12",
            marginUsed: "5",
          },
        ],
      })
    );
    expect(result.slices.every((s) => s.amount > 0)).toBe(true);
    expect(result.slices.map((s) => s.key)).toEqual(["pea"]);
  });

  it("Σ venues = total ; % = Hamilton sur les montants bruts", () => {
    const result = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "pea",
            accountType: "PEA",
            assetClass: "ACTIONS",
            marketValueEur: "204590",
          }),
          holding({
            id: "cto",
            accountType: "CTO",
            assetClass: "ACTIONS",
            marketValueEur: "192750",
          }),
          holding({
            id: "av",
            accountType: "AV",
            assetClass: "ACTIONS",
            marketValueEur: "35500",
          }),
        ],
        bankAccounts: [{ balanceEur: "50000" }],
        metals: [{ format: "PHYSICAL", currentValueEur: "15000" }],
      })
    );

    expect(sumVenueAmounts(result)).toBeCloseTo(result.total, 8);
    const hamilton = allocatePercents(
      result.slices.map((s) => s.amount),
      1
    );
    expect(result.slices.map((s) => s.percent)).toEqual(hamilton);
    expect(hamilton.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 8);

    const roundedFirst = result.slices.map(
      (s) => Math.round(s.amount * 100) / 100
    );
    const ifRounded = allocatePercents(roundedFirst, 1);
    expect(result.slices.map((s) => s.percent)).toEqual(hamilton);
    void ifRounded;
  });
});

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
  tradingEquityEur,
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
      quoteCurrency: "USD",
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
        // La manche reçoit désormais une equity **déjà en euros** — la
        // conversion se fait au chargement, comme pour toutes les autres.
        tradingPositions: [{ equityEur: equity }],
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
      quoteCurrency: "USD",
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
        tradingPositions: [{ equityEur: tradingEquityOf(closed) }],
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
      quoteCurrency: "USD",
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
        tradingPositions: [{ equityEur: 0 }],
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

/**
 * D29 — l'immobilier au sens du contrat, et les dettes qui ne s'évaporent plus.
 *
 * Deux défauts relevés en revue, mesurés ici : une SCPI mal étiquetée quittait
 * l'immobilier et emportait la déduction de son crédit ; une dette rattachée à
 * un actif que le camembert ne pouvait pas réduire disparaissait sans trace,
 * gonflant le total et donc les dix pourcentages.
 */
describe("D29 — classement immobilier et dettes non affectées", () => {
  it("range une SCPI étiquetée ACTIONS dans l'immobilier, et lui soustrait son crédit", () => {
    const res = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "scpi-1",
            accountType: "CTO",
            assetClass: "ACTIONS",
            marketValueEur: 100_000,
            hasIndirectRealEstateDetail: true,
          }),
        ],
        liabilities: [{ assetId: "scpi-1", remainingEur: 40_000 }],
      })
    );

    // Avant : 100 000 € en `cto`, crédit jamais soustrait — le donut portait
    // le prêt entier en trop, quand la bande d'indicateurs rangeait la même
    // ligne dans l'immobilier.
    expect(amountOf(res, "immo")).toBe(60_000);
    expect(amountOf(res, "cto")).toBe(0);
    expect(res.unallocatedLiabilitiesEur).toBe(0);
  });

  it("suit `classifyHolding` aussi pour une fiche immobilier direct", () => {
    const res = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "bien-1",
            accountType: "CTO",
            assetClass: "AUTRE",
            marketValueEur: 250_000,
            hasRealEstateDetail: true,
          }),
        ],
      })
    );
    expect(amountOf(res, "immo")).toBe(250_000);
  });

  it("réduit le CTO d'un prêt lombard adossé à une ligne du compte", () => {
    const res = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "action-1",
            accountType: "CTO",
            assetClass: "ACTIONS",
            marketValueEur: 80_000,
          }),
        ],
        liabilities: [{ assetId: "action-1", remainingEur: 30_000 }],
      })
    );
    expect(amountOf(res, "cto")).toBe(50_000);
    expect(res.unallocatedLiabilitiesEur).toBe(0);
  });

  it("compte hors camembert la dette d'un bien vendu", () => {
    // Le bien est sorti du journal (quantité nulle → absent des holdings), le
    // prêt existe encore. Il ne réduit plus rien : il doit se voir ailleurs.
    const res = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "pea-1",
            accountType: "PEA",
            assetClass: "ACTIONS",
            marketValueEur: 20_000,
          }),
        ],
        liabilities: [{ assetId: "bien-vendu", remainingEur: 120_000 }],
      })
    );

    expect(amountOf(res, "pea")).toBe(20_000);
    expect(res.total).toBe(20_000);
    expect(res.unallocatedLiabilitiesEur).toBe(120_000);
  });

  it("compte hors camembert la part de CRD qui dépasse la valeur du bien", () => {
    const res = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "bien-1",
            accountType: "IMMOBILIER",
            assetClass: "IMMOBILIER",
            marketValueEur: 150_000,
          }),
        ],
        liabilities: [{ assetId: "bien-1", remainingEur: 200_000 }],
      })
    );

    // La part reste plancher à zéro — on n'invente pas un endroit négatif —
    // mais les 50 000 € que le plancher absorbait ne sont plus perdus.
    expect(amountOf(res, "immo")).toBe(0);
    expect(res.unallocatedLiabilitiesEur).toBe(50_000);
  });

  it("ne laisse pas un CFD consommer la dette qu'il ne peut pas réduire", () => {
    // Une ligne CFD est hors donut (le notionnel n'y entre jamais). Sa dette
    // éventuelle ne doit pas s'évaporer avec elle.
    const res = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "cfd-1",
            accountType: "CFD",
            assetClass: "ACTIONS",
            marketValueEur: 10_000,
          }),
        ],
        liabilities: [{ assetId: "cfd-1", remainingEur: 5_000 }],
      })
    );
    expect(res.total).toBe(0);
    expect(res.unallocatedLiabilitiesEur).toBe(5_000);
  });

  it("laisse un passif sans assetId hors du compte : il n'a pas de collatéral", () => {
    const res = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "pea-1",
            accountType: "PEA",
            assetClass: "ACTIONS",
            marketValueEur: 20_000,
          }),
        ],
        liabilities: [{ assetId: null, remainingEur: 15_000 }],
      })
    );
    expect(amountOf(res, "pea")).toBe(20_000);
    expect(res.unallocatedLiabilitiesEur).toBe(0);
  });
});

/**
 * D29 — le trading entrait brut dans un camembert en euros.
 *
 * `toFuturesView` rend une equity dans la devise de cotation ; le suffixe
 * `Eur` de `unrealizedPnlEur` est un abus de langage hérité, rien ne convertit
 * dans la chaîne trading. Un perpétuel BTC/USDT à 10 000 USDT de marge pesait
 * donc 10 000 € — et faussait le dénominateur, donc les dix pourcentages.
 */
describe("D29 — equity de trading ramenée en euros", () => {
  const RATES = { USD: 1.08 };

  const position = {
    isOpen: true,
    direction: "LONG" as const,
    leverage: "10",
    sizeContracts: "1",
    entryPrice: "60000",
    markPrice: "60000",
    marginUsed: null,
    quoteCurrency: "USD",
  };

  it("convertit l'equity depuis la devise de cotation", () => {
    const brut = tradingEquityOf(position);
    expect(brut.toFixed(2)).toBe("6000.00");

    const eur = tradingEquityEur(position, RATES);
    expect(eur).not.toBeNull();
    // 6 000 USD à 1,08 USD pour un euro : 5 555,56 €, pas 6 000 €.
    expect(eur!.toFixed(2)).toBe("5555.56");
    expect(eur!.lt(brut)).toBe(true);
  });

  it("laisse un montant déjà en euros intact", () => {
    const eur = tradingEquityEur(
      { ...position, quoteCurrency: "EUR" },
      RATES
    );
    expect(eur!.toFixed(2)).toBe("6000.00");
  });

  it("rend null — ni zéro, ni parité — quand la devise n'a pas de taux", () => {
    /*
      `USDT` est la cotation du perpétuel le plus courant et n'est dans aucune
      table de taux : ni Frankfurter (ISO seulement), ni le repli maison. Le
      compter à parité inventerait un taux ; le compter zéro effacerait la
      position ; laisser l'exception remonter ferait tomber tout le donut pour
      une ligne. UNKNOWN n'est ni ZERO ni ERROR.
    */
    expect(tradingEquityEur({ ...position, quoteCurrency: "USDT" }, RATES)).toBeNull();
    expect(tradingEquityEur({ ...position, quoteCurrency: "USDC" }, RATES)).toBeNull();
  });

  it("rend zéro sans convertir quand la position est close", () => {
    const eur = tradingEquityEur(
      { ...position, isOpen: false, quoteCurrency: "USDT" },
      RATES
    );
    expect(eur).not.toBeNull();
    expect(eur!.toNumber()).toBe(0);
  });

  it("le résultat compte les positions écartées faute de taux", () => {
    const res = computeAllocationByVenue(
      baseInput({
        tradingPositions: [{ equityEur: "5555.56" }],
        unconvertedTradingPositions: 2,
      })
    );
    expect(amountOf(res, "trading")).toBeCloseTo(5555.56, 6);
    expect(res.unconvertedTradingPositions).toBe(2);
  });
});

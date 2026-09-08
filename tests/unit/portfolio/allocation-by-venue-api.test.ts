import { describe, expect, it } from "vitest";
import { allocatePercents } from "@/app/lib/ui/allocate-percents";
import {
  ALLOCATION_BY_VENUE_HELP,
  VENUE_COLORS,
  VENUE_LABELS,
  computeAllocationByVenue,
  type AllocationByVenue,
  type AllocationByVenueInput,
  type VenueHoldingInput,
  type VenueKey,
} from "@/app/lib/portfolio/allocation-by-venue";
import { toAllocationByVenueApi } from "@/app/lib/portfolio/allocation-by-venue-api";

function holding(partial: VenueHoldingInput): VenueHoldingInput {
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

describe("toAllocationByVenueApi — contrat { venues, help, total, asOf }", () => {
  it("projette key/amount/percent vers id/amountEur/pct et omet les parts 0", () => {
    const computed = computeAllocationByVenue(
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
        ],
        envelopeCash: [{ envelope: "AV", balanceEur: "0" }],
        crowdlending: [{ status: "REPAID", capitalInvestedEur: "3000" }],
        // Position close : equity nulle. La manche reçoit des euros, la
        // conversion ayant lieu au chargement (D29).
        tradingPositions: [{ equityEur: "0" }],
      })
    );

    const api = toAllocationByVenueApi(computed);

    expect(api.venues.every((v) => v.amountEur > 0)).toBe(true);
    expect(api.venues.map((v) => v.id)).toEqual(["pea", "cto"]);
    expect(api.venues.some((v) => v.id === "av")).toBe(false);
    expect(api.venues.some((v) => v.id === "trading")).toBe(false);
    expect(api.venues.some((v) => v.id === "alt")).toBe(false);

    expect(api.venues.map((v) => v.amountEur)).toEqual(
      computed.slices.map((s) => s.amount)
    );
    expect(api.venues.map((v) => v.pct)).toEqual(
      computed.slices.map((s) => s.percent)
    );
    expect(api.total).toBe(computed.total);
    expect(api.asOf).toBe("2026-09-06T00:00:00.000Z");
    expect(api.venues[0]).toEqual({
      id: "pea",
      label: VENUE_LABELS.pea,
      amountEur: 6080,
      pct: computed.slices[0]!.percent,
      color: VENUE_COLORS.pea,
    });
  });

  it("lit label et color depuis VENUE_LABELS / VENUE_COLORS, pas depuis la slice", () => {
    const computed = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "btc",
            accountType: "CRYPTO",
            assetClass: "CRYPTO",
            marketValueEur: "21700",
          }),
        ],
      })
    );
    const tampered: AllocationByVenue = {
      ...computed,
      slices: computed.slices.map((s) => ({
        ...s,
        label: "WRONG",
        color: "#000000",
      })),
    };

    const api = toAllocationByVenueApi(tampered);
    expect(api.venues).toHaveLength(1);
    expect(api.venues[0]!.id).toBe("crypto");
    expect(api.venues[0]!.label).toBe(VENUE_LABELS.crypto);
    expect(api.venues[0]!.color).toBe(VENUE_COLORS.crypto);
    expect(api.venues[0]!.label).not.toBe("WRONG");
    expect(api.venues[0]!.color).not.toBe("#000000");
  });

  it("expose ALLOCATION_BY_VENUE_HELP tel quel, sans le reformuler", () => {
    const api = toAllocationByVenueApi(computeAllocationByVenue(baseInput()));
    expect(api.help).toBe(ALLOCATION_BY_VENUE_HELP);
    expect(api.help).toBe(
      "Répartition par compte et poche de détention. L’immobilier est en valeur nette (bien moins le capital restant dû) ; chaque échéance (part capital) fait monter cette part. Le patrimoine financier affiché en haut n’inclut pas l’immobilier ni les poches illiquides."
    );
  });

  it("n'émet aucune part à 0 même si une slice nulle est injectée", () => {
    const api = toAllocationByVenueApi({
      slices: [
        {
          key: "pea",
          label: "PEA",
          amount: 1000,
          percent: 100,
          color: VENUE_COLORS.pea,
        },
        {
          key: "cto",
          label: "CTO",
          amount: 0,
          percent: 0,
          color: VENUE_COLORS.cto,
        },
      ],
      total: 1000,
      asOf: "2026-09-06T00:00:00.000Z",
      // Ni dette non affectée, ni position non convertie dans ce cas
      // construit : ces deux champs existent depuis D29 et font partie du
      // contrat même à zéro.
      unallocatedLiabilitiesEur: 0,
      unconvertedTradingPositions: 0,
    });
    expect(api.venues.map((v) => v.id)).toEqual(["pea"]);
    expect(api.venues.every((v) => v.amountEur > 0)).toBe(true);
  });

  it("reprend les % Hamilton de D14.1 — pas un second algorithme", () => {
    const computed = computeAllocationByVenue(
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
    const api = toAllocationByVenueApi(computed);
    const hamilton = allocatePercents(
      api.venues.map((v) => v.amountEur),
      1
    );
    expect(api.venues.map((v) => v.pct)).toEqual(hamilton);
    expect(api.venues.map((v) => v.pct)).toEqual(
      computed.slices.map((s) => s.percent)
    );
    expect(hamilton.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 8);
  });

  it("enveloppe vide : venues [], total 0, help et asOf présents", () => {
    const api = toAllocationByVenueApi(computeAllocationByVenue(baseInput()));
    expect(api.venues).toEqual([]);
    expect(api.total).toBe(0);
    expect(api.help).toBe(ALLOCATION_BY_VENUE_HELP);
    expect(api.asOf).toBe("2026-09-06T00:00:00.000Z");
  });

  it("couvre les 10 endroits avec les constantes figées quand tous sont > 0", () => {
    const keys: VenueKey[] = [
      "pea",
      "cto",
      "av",
      "immo",
      "cash",
      "es",
      "trading",
      "crypto",
      "alt",
      "tangible",
    ];
    const computed = computeAllocationByVenue(
      baseInput({
        holdings: [
          holding({
            id: "pea",
            accountType: "PEA",
            assetClass: "ACTIONS",
            marketValueEur: "10",
          }),
          holding({
            id: "cto",
            accountType: "CTO",
            assetClass: "ACTIONS",
            marketValueEur: "20",
          }),
          holding({
            id: "av",
            accountType: "AV",
            assetClass: "ACTIONS",
            marketValueEur: "30",
          }),
          holding({
            id: "immo",
            accountType: "IMMOBILIER",
            assetClass: "IMMOBILIER",
            marketValueEur: "40",
          }),
          holding({
            id: "btc",
            accountType: "CRYPTO",
            assetClass: "CRYPTO",
            marketValueEur: "50",
          }),
        ],
        bankAccounts: [{ balanceEur: "60" }],
        employeeSavings: [{ valueEur: "70" }],
        privateEquity: [{ currentNavEur: "80" }],
        tangibles: [{ estimatedValueEur: "90" }],
        tradingPositions: [{ equityEur: "100" }],
      })
    );
    const api = toAllocationByVenueApi(computed);
    expect(api.venues.map((v) => v.id)).toEqual(keys);
    for (const v of api.venues) {
      expect(v.label).toBe(VENUE_LABELS[v.id]);
      expect(v.color).toBe(VENUE_COLORS[v.id]);
    }
  });
});

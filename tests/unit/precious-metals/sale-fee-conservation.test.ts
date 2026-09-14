import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ALT-03 — une vente partielle proratise les frais d'acquisition dans le
 * coût de la cession (`costBasis = quantity × PRU + fees × share`), mais le
 * lot restant doit voir ses `acquisitionFees` réduits de cette même part :
 * sans ça, le coût du stock restant (`mapRow`) recompte les frais déjà
 * imputés à la cession. Invariant vérifié ici :
 *
 *   Σ(costBasis des cessions) + costBasis du stock restant
 *     = coût initial total (prix + frais)
 *
 * après une vente partielle, après plusieurs ventes partielles successives,
 * et à la vente du solde complet (les frais du lot doivent retomber à 0,
 * pas un résidu).
 */

const UNIT_PRICE = 100;
const INITIAL_QTY = 10;
const INITIAL_FEES = 50;
const INITIAL_COST = INITIAL_QTY * UNIT_PRICE + INITIAL_FEES; // 1050

const { state, fakePrisma } = vi.hoisted(() => {
  type LotState = {
    id: string;
    quantity: string;
    purchasePriceUnit: string;
    acquisitionFees: string;
    currentValue: string;
    denomination: string;
    acquiredAt: Date | null;
    hasInvoice: boolean;
  };

  const state: { lot: LotState; sales: Array<{ costBasisEur: string }> } = {
    lot: {
      id: "lot-1",
      quantity: "0",
      purchasePriceUnit: "0",
      acquisitionFees: "0",
      currentValue: "0",
      denomination: "Napoléon",
      acquiredAt: new Date("2020-01-01"),
      hasInvoice: true,
    },
    sales: [],
  };

  const fakePrisma = {
    preciousMetalPosition: {
      findFirst: async () => ({ ...state.lot }),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        state.lot = {
          ...state.lot,
          ...(data.quantity !== undefined ? { quantity: String(data.quantity) } : {}),
          ...(data.currentValue !== undefined
            ? { currentValue: String(data.currentValue) }
            : {}),
          ...(data.acquisitionFees !== undefined
            ? { acquisitionFees: String(data.acquisitionFees) }
            : {}),
        };
        return { count: 1 };
      },
    },
    preciousMetalSale: {
      create: async ({ data }: { data: { costBasisEur: unknown } }) => {
        const row = {
          id: `s${state.sales.length + 1}`,
          positionId: state.lot.id,
          denomination: state.lot.denomination,
          quantity: "0",
          salePriceEur: "0",
          saleFeesEur: "0",
          costBasisEur: String(data.costBasisEur),
          soldAt: new Date("2025-01-01"),
          acquiredAt: null,
          regime: "FORFAIT",
          hasInvoice: false,
          notes: null,
        };
        state.sales.push({ costBasisEur: row.costBasisEur });
        return row;
      },
    },
  };

  return { state, fakePrisma };
});

vi.mock("@/app/lib/prisma", () => ({ prisma: fakePrisma }));

import { createPreciousMetalSale } from "@/app/lib/alternatives/precious-metals";

function resetLot() {
  state.lot = {
    id: "lot-1",
    quantity: String(INITIAL_QTY),
    purchasePriceUnit: String(UNIT_PRICE),
    acquisitionFees: String(INITIAL_FEES),
    currentValue: String(INITIAL_QTY * UNIT_PRICE),
    denomination: "Napoléon",
    acquiredAt: new Date("2020-01-01"),
    hasInvoice: true,
  };
  state.sales = [];
}

function remainingLotCost(): number {
  const qty = Number(state.lot.quantity);
  const fees = Number(state.lot.acquisitionFees);
  return qty * UNIT_PRICE + fees;
}

function totalSalesCost(): number {
  return state.sales.reduce((sum, s) => sum + Number(s.costBasisEur), 0);
}

beforeEach(() => {
  resetLot();
});

describe("ALT-03 — conservation du coût total après vente(s) partielle(s)", () => {
  it("une vente partielle ne recompte pas les frais du lot restant", async () => {
    await createPreciousMetalSale("u1", {
      positionId: "lot-1",
      quantity: 4,
      salePriceEur: 500,
      soldAt: "2025-06-01",
    });

    // coût de la cession = 4×100 + 50×(4/10) = 420
    expect(Number(state.sales[0]!.costBasisEur)).toBeCloseTo(420, 6);
    // frais restants sur le lot = 50 × (1 - 0.4) = 30
    expect(Number(state.lot.acquisitionFees)).toBeCloseTo(30, 6);
    // coût du reste = 6×100 + 30 = 630
    expect(remainingLotCost()).toBeCloseTo(630, 6);
    // invariant : cession + reste = coût initial (1050)
    expect(totalSalesCost() + remainingLotCost()).toBeCloseTo(INITIAL_COST, 6);
  });

  it("plusieurs ventes partielles successives conservent le coût total", async () => {
    await createPreciousMetalSale("u1", {
      positionId: "lot-1",
      quantity: 4,
      salePriceEur: 500,
      soldAt: "2025-06-01",
    });
    await createPreciousMetalSale("u1", {
      positionId: "lot-1",
      quantity: 3,
      salePriceEur: 400,
      soldAt: "2025-07-01",
    });

    expect(totalSalesCost() + remainingLotCost()).toBeCloseTo(INITIAL_COST, 6);
    // 3 unités restantes, frais 15 (30 × (1 - 3/6))
    expect(Number(state.lot.quantity)).toBeCloseTo(3, 6);
    expect(Number(state.lot.acquisitionFees)).toBeCloseTo(15, 6);
  });

  it("vente du solde complet : les frais du lot retombent à 0, pas un résidu", async () => {
    await createPreciousMetalSale("u1", {
      positionId: "lot-1",
      quantity: 10,
      salePriceEur: 1200,
      soldAt: "2025-06-01",
    });

    expect(Number(state.lot.quantity)).toBe(0);
    expect(Number(state.lot.acquisitionFees)).toBe(0);
    expect(totalSalesCost()).toBeCloseTo(INITIAL_COST, 6);
  });
});

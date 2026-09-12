import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Un dépôt à terme est de l'argent.
 *
 * `prisma.termDeposit` n'était lu que par l'onglet Banques
 * (`summarizeCash().termDepositTotalBase`). Un CAT de 100 000 € s'affichait
 * donc dans sa liste, avec son échéance et son taux, et n'existait ni dans le
 * patrimoine net, ni dans la répartition par endroit, ni dans la courbe : trois
 * écrans le niaient, un seul le montrait.
 *
 * Ces tests verrouillent les trois chemins. La conversion et la quote-part sont
 * celles des deux autres poches — un CAT professionnel ne compte pas, un CAT
 * détenu à moitié compte pour moitié.
 */

const bankFindMany = vi.fn();
const savingsFindMany = vi.fn();
const termDepositFindMany = vi.fn();
const envelopeFindMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    bankAccount: { findMany: (...a: unknown[]) => bankFindMany(...a) },
    savingsAccount: { findMany: (...a: unknown[]) => savingsFindMany(...a) },
    termDeposit: { findMany: (...a: unknown[]) => termDepositFindMany(...a) },
    envelopeCash: { findMany: (...a: unknown[]) => envelopeFindMany(...a) },
  },
}));

/** 0,94 CHF pour un euro. */
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1, CHF: 0.94 }) };
});

import { getExplicitCashTotalEur } from "@/app/lib/cash/pockets";
import { computeAllocationByVenue } from "@/app/lib/portfolio/allocation-by-venue";
import type { AllocationByVenueInput } from "@/app/lib/portfolio/allocation-by-venue";

const dec = (v: string) => ({ toString: () => v });

function cat(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    principal: dec("100000"),
    currency: "EUR",
    isPro: false,
    ownershipPct: null,
    ...over,
  };
}

beforeEach(() => {
  bankFindMany.mockReset().mockResolvedValue([]);
  savingsFindMany.mockReset().mockResolvedValue([]);
  termDepositFindMany.mockReset().mockResolvedValue([]);
  envelopeFindMany.mockReset().mockResolvedValue([]);
});

const total = async () => Number((await getExplicitCashTotalEur("u1")).totalEur);

describe("patrimoine net", () => {
  it("un CAT de 100 000 € entre dans le total", async () => {
    termDepositFindMany.mockResolvedValue([cat()]);
    expect(await total()).toBe(100000);
  });

  it("un CAT professionnel n'y entre pas", async () => {
    termDepositFindMany.mockResolvedValue([cat({ isPro: true })]);
    expect(await total()).toBe(0);
  });

  it("un CAT détenu à 50 % compte pour moitié", async () => {
    termDepositFindMany.mockResolvedValue([cat({ ownershipPct: dec("50") })]);
    expect(await total()).toBe(50000);
  });

  it("un CAT en devise est converti, jamais compté à parité", async () => {
    termDepositFindMany.mockResolvedValue([
      cat({ principal: dec("100000"), currency: "CHF" }),
    ]);
    // 100 000 / 0,94 = 106 382,98 €
    expect(await total()).toBeCloseTo(106382.98, 2);
  });
});

function baseInput(over: Partial<AllocationByVenueInput> = {}): AllocationByVenueInput {
  return {
    holdings: [],
    envelopeCash: [],
    bankAccounts: [],
    savingsAccounts: [],
    termDeposits: [],
    employeeSavings: [],
    liabilities: [],
    metals: [],
    privateEquity: [],
    crowdlending: [],
    tangibles: [],
    tradingPositions: [],
    asOf: "2026-09-12T00:00:00.000Z",
    ...over,
  };
}

describe("répartition par endroit", () => {
  it("le CAT rejoint les liquidités, avec banques et livrets", () => {
    const result = computeAllocationByVenue(
      baseInput({
        bankAccounts: [{ balanceEur: "2000" }],
        savingsAccounts: [{ balanceEur: "8000" }],
        termDeposits: [{ principalEur: "100000" }],
      })
    );
    const cash = result.slices.find((s) => s.key === "cash");
    expect(cash?.amount).toBe(110000);
    // Le total du donut le porte aussi : sans quoi les dix pourcentages
    // seraient calculés sur un patrimoine amputé du CAT.
    expect(result.total).toBe(110000);
  });

  it("aucun CAT ne fait aucune part", () => {
    const result = computeAllocationByVenue(baseInput());
    expect(result.slices.find((s) => s.key === "cash")).toBeUndefined();
  });
});

describe("courbe historique", () => {
  it("le chargeur lit la table des dépôts à terme", () => {
    /*
      Contrôle structurel, comme `liabilities-lecture-pure` : le moteur
      historique est synchrone et ses sources sont préchargées en une passe.
      Ce qui manquait n'était pas un calcul mais une requête — si elle
      disparaît, le dernier point de la courbe redevient inférieur à la tuile
      du patrimoine net du montant des CAT.
    */
    const src = readFileSync(
      resolve(process.cwd(), "app/lib/portfolio/historical/load.ts"),
      "utf8"
    );
    expect(src).toContain("prisma.termDeposit.findMany");
    expect(src).toContain("termDeposits.map");
  });
});

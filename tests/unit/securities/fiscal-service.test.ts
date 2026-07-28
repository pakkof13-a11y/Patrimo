import { describe, expect, it, beforeEach, vi } from "vitest";
import { d } from "@/app/lib/money/decimal";

/**
 * Service fiscal — Prisma et la valorisation mockés.
 *
 * Ce qui se vérifie ici et nulle part ailleurs : le croisement des versements
 * des deux plans avant tout calcul de plafond, et l'imputation des espèces,
 * qui n'est exacte que lorsqu'un seul compte porte l'enveloppe.
 */

const accountFindMany = vi.fn();
const accountFindFirst = vi.fn();
const envelopeCashFindMany = vi.fn();
const contributionCreate = vi.fn();
const contributionFindMany = vi.fn();
const contributionDeleteMany = vi.fn();
const getAssetValuesMock = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    securitiesAccount: {
      findMany: (...a: unknown[]) => accountFindMany(...a),
      findFirst: (...a: unknown[]) => accountFindFirst(...a),
    },
    envelopeCash: {
      findMany: (...a: unknown[]) => envelopeCashFindMany(...a),
    },
    securitiesAccountContribution: {
      create: (...a: unknown[]) => contributionCreate(...a),
      findMany: (...a: unknown[]) => contributionFindMany(...a),
      deleteMany: (...a: unknown[]) => contributionDeleteMany(...a),
    },
  },
}));

vi.mock("@/app/lib/portfolio/asset-values", () => ({
  getAssetValues: (...a: unknown[]) => getAssetValuesMock(...a),
}));

const {
  getSecuritiesFiscalBundle,
  recordContribution,
  deleteContribution,
} = await import("@/app/lib/securities/fiscal-service");

const USER = "user-1";
const NOW = new Date("2026-07-28T00:00:00Z");

function account(over: Record<string, unknown> = {}) {
  return {
    id: "acc-pea",
    envelopeType: "PEA",
    openDate: new Date("2019-03-01T00:00:00Z"),
    assets: [],
    contributions: [],
    ...over,
  };
}

function contribution(type: string, amount: string) {
  return { type, amountEur: { toString: () => amount } };
}

beforeEach(() => {
  vi.clearAllMocks();
  envelopeCashFindMany.mockResolvedValue([]);
  getAssetValuesMock.mockResolvedValue(new Map());
  accountFindFirst.mockResolvedValue({ id: "acc-pea" });
});

describe("getSecuritiesFiscalBundle — sans compte", () => {
  it("renvoie une liste vide sans interroger la valorisation", async () => {
    accountFindMany.mockResolvedValue([]);
    await expect(getSecuritiesFiscalBundle(USER, NOW)).resolves.toEqual([]);
    expect(getAssetValuesMock).not.toHaveBeenCalled();
  });
});

describe("getSecuritiesFiscalBundle — versements", () => {
  it("ne compte que les dépôts dans les versements cumulés", async () => {
    accountFindMany.mockResolvedValue([
      account({
        contributions: [
          contribution("DEPOSIT", "10000"),
          contribution("DEPOSIT", "5000"),
          contribution("WITHDRAWAL", "3000"),
        ],
      }),
    ]);
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    // Un retrait ne restaure pas de place sous le plafond.
    expect(s!.contributionsEur.toNumber()).toBe(15_000);
    expect(s!.withdrawalsEur.toNumber()).toBe(3_000);
  });
});

describe("getSecuritiesFiscalBundle — plafond croisé", () => {
  it("la place du PEA-PME tient compte de ce qui est versé sur le PEA", async () => {
    accountFindMany.mockResolvedValue([
      account({
        id: "acc-pea",
        envelopeType: "PEA",
        contributions: [contribution("DEPOSIT", "150000")],
      }),
      account({
        id: "acc-pme",
        envelopeType: "PEA_PME",
        contributions: [],
      }),
    ]);

    const summaries = await getSecuritiesFiscalBundle(USER, NOW);
    const pme = summaries.find((s) => s.accountId === "acc-pme")!;

    // Le PEA-PME est vide : isolément il afficherait 225 000 € de place.
    expect(pme.room!.remainingEur.toNumber()).toBe(75_000);
    expect(pme.room!.bindingCap).toBe("COMBINED");
  });

  it("un compte-titres n'a ni plafond, ni maturité, ni statut fiscal PEA", async () => {
    accountFindMany.mockResolvedValue([
      account({ id: "acc-cto", envelopeType: "CTO" }),
    ]);
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.room).toBeNull();
    expect(s!.maturity).toBeNull();
    expect(s!.taxStatusLabel).toBeNull();
  });
});

describe("getSecuritiesFiscalBundle — imputation des espèces", () => {
  it("le PEA étant unique, sa poche lui est imputée intégralement", async () => {
    accountFindMany.mockResolvedValue([account()]);
    envelopeCashFindMany.mockResolvedValue([
      { envelope: "PEA", balance: { toString: () => "4000" } },
    ]);
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.cashEur.toNumber()).toBe(4_000);
    expect(s!.cashAttributed).toBe(true);
  });

  it("avec deux CTO, la poche n'est imputée à aucun — et c'est signalé", async () => {
    accountFindMany.mockResolvedValue([
      account({ id: "cto-1", envelopeType: "CTO" }),
      account({ id: "cto-2", envelopeType: "CTO" }),
    ]);
    envelopeCashFindMany.mockResolvedValue([
      { envelope: "CTO", balance: { toString: () => "9000" } },
    ]);
    const summaries = await getSecuritiesFiscalBundle(USER, NOW);
    for (const s of summaries) {
      expect(s.cashEur.toNumber()).toBe(0);
      // Mieux vaut un zéro signalé qu'une répartition inventée.
      expect(s.cashAttributed).toBe(false);
    }
  });

  it("le PEA-PME n'a pas de poche dédiée : rien ne lui est imputé", async () => {
    accountFindMany.mockResolvedValue([
      account({ id: "acc-pme", envelopeType: "PEA_PME" }),
    ]);
    envelopeCashFindMany.mockResolvedValue([
      { envelope: "PEA", balance: { toString: () => "4000" } },
    ]);
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.cashEur.toNumber()).toBe(0);
    expect(s!.cashAttributed).toBe(false);
  });
});

describe("getSecuritiesFiscalBundle — valeur liquidative et gain", () => {
  it("titres valorisés au journal + espèces imputées", async () => {
    accountFindMany.mockResolvedValue([
      account({
        assets: [{ id: "a1" }, { id: "a2" }],
        contributions: [contribution("DEPOSIT", "50000")],
      }),
    ]);
    getAssetValuesMock.mockResolvedValue(
      new Map([
        ["a1", { marketValueEur: d(30_000) }],
        ["a2", { marketValueEur: d(25_000) }],
      ])
    );
    envelopeCashFindMany.mockResolvedValue([
      { envelope: "PEA", balance: { toString: () => "5000" } },
    ]);

    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.positionsValueEur.toNumber()).toBe(55_000);
    expect(s!.liquidationValueEur.toNumber()).toBe(60_000);
    expect(s!.gainEur.toNumber()).toBe(10_000);
  });

  it("une moins-value ressort en gain négatif", async () => {
    accountFindMany.mockResolvedValue([
      account({
        assets: [{ id: "a1" }],
        contributions: [contribution("DEPOSIT", "50000")],
      }),
    ]);
    getAssetValuesMock.mockResolvedValue(
      new Map([["a1", { marketValueEur: d(38_000) }]])
    );
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.gainEur.toNumber()).toBe(-12_000);
  });

  it("une position sans valorisation au journal est ignorée, pas comptée à zéro faussement", async () => {
    accountFindMany.mockResolvedValue([
      account({ assets: [{ id: "a1" }, { id: "fermee" }] }),
    ]);
    getAssetValuesMock.mockResolvedValue(
      new Map([["a1", { marketValueEur: d(1_000) }]])
    );
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.positionsValueEur.toNumber()).toBe(1_000);
  });
});

describe("getSecuritiesFiscalBundle — maturité", () => {
  it("un PEA ouvert en 2019 est mûr en 2026 et le libellé mentionne les PS", async () => {
    accountFindMany.mockResolvedValue([account()]);
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.maturity!.isMatured).toBe(true);
    expect(s!.taxStatusLabel).toMatch(/18,6/);
  });

  it("un PEA récent ne l'est pas", async () => {
    accountFindMany.mockResolvedValue([
      account({ openDate: new Date("2024-01-01T00:00:00Z") }),
    ]);
    const [s] = await getSecuritiesFiscalBundle(USER, NOW);
    expect(s!.maturity!.isMatured).toBe(false);
    expect(s!.taxStatusLabel).toMatch(/12,8/);
  });
});

describe("recordContribution", () => {
  it("refuse un type inconnu", async () => {
    await expect(
      recordContribution(USER, "acc-pea", {
        type: "VIREMENT",
        amountEur: "100",
        occurredAt: "2026-01-01",
      })
    ).rejects.toThrow(/inconnu/i);
  });

  it("refuse un montant négatif — le signe est porté par le type", async () => {
    await expect(
      recordContribution(USER, "acc-pea", {
        type: "DEPOSIT",
        amountEur: "-100",
        occurredAt: "2026-01-01",
      })
    ).rejects.toThrow(/strictement positif/i);
  });

  it("refuse une date invalide", async () => {
    await expect(
      recordContribution(USER, "acc-pea", {
        type: "DEPOSIT",
        amountEur: "100",
        occurredAt: "pas une date",
      })
    ).rejects.toThrow(/invalide/i);
  });

  it("refuse un compte qui n'appartient pas à l'utilisateur", async () => {
    accountFindFirst.mockResolvedValue(null);
    await expect(
      recordContribution(USER, "acc-autrui", {
        type: "DEPOSIT",
        amountEur: "100",
        occurredAt: "2026-01-01",
      })
    ).rejects.toThrow(/introuvable/i);
  });
});

describe("deleteContribution", () => {
  it("scope la suppression par le propriétaire du compte", async () => {
    contributionDeleteMany.mockResolvedValue({ count: 1 });
    await deleteContribution(USER, "c1");
    expect(contributionDeleteMany.mock.calls[0]![0].where).toEqual({
      id: "c1",
      account: { is: { userId: USER } },
    });
  });

  it("ne supprime rien si le mouvement appartient à autrui", async () => {
    contributionDeleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteContribution(USER, "c-autrui")).resolves.toEqual({
      deleted: false,
    });
  });
});

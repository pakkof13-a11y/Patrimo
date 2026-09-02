import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/lib/prisma-client/client";

/**
 * L'accrual d'intérêts ne peut plus écraser un état qu'il n'a pas lu.
 *
 * Le cycle est : lire la ligne, calculer les périodes dues, écrire le solde et
 * l'événement. L'écriture ne filtrait que sur l'identité de la ligne, si bien
 * que tout ce qui survenait entre la lecture et l'écriture était perdu — une
 * saisie utilisateur comprise :
 *
 *   solde lu 10 000 → l'accrual calcule 10 100
 *   l'utilisateur saisit 12 000
 *   l'accrual écrit 10 100
 *
 * L'écriture exige désormais le solde et le `lastPayoutAt` observés.
 *
 * ## Comment la concurrence est reproduite ici
 *
 * La base est simulée par une ligne en mémoire, et le faux `updateMany`
 * applique la même règle qu'un SGBD : il évalue le `where` contre l'état
 * **courant** du magasin, pas contre celui de la lecture. Un crochet permet de
 * modifier cet état juste avant l'évaluation, ce qui interpose une écriture
 * concurrente exactement entre la lecture et l'écriture de l'accrual.
 *
 * Limite assumée : ce test ne fait pas tourner deux transactions réellement
 * simultanées. Il vérifie que le compare-and-set est présent, qu'il porte sur
 * le bon état et qu'il refuse d'écrire quand cet état a bougé — c'est le
 * mécanisme qui rend l'écriture sûre, la simultanéité réelle étant garantie
 * par l'atomicité de l'UPDATE côté base.
 */

type Ligne = {
  id: string;
  userId: string;
  balance: Prisma.Decimal;
  apyPercent: Prisma.Decimal;
  rateType: string;
  payoutFrequency: string;
  payoutDayOfWeek: number | null;
  payoutDayOfMonth: number | null;
  payoutMonth: number | null;
  lastPayoutAt: Date | null;
  lastAccruedAt: Date;
  createdAt: Date;
};

/** L'unique ligne en base, mutable comme le serait une vraie table. */
let magasin: Ligne;
/** Écriture concurrente jouée juste avant l'évaluation du `where`. */
let avantEcriture: (() => void) | null = null;
const evenements: Array<{ type: string; montant: string; soldeApres: string }> = [];
const updateManyCalls: Array<Record<string, unknown>> = [];

function correspond(where: Record<string, unknown>): boolean {
  if (where.id !== magasin.id || where.userId !== magasin.userId) return false;
  if (where.balance !== undefined) {
    if (String(where.balance) !== String(magasin.balance)) return false;
  }
  if ("lastPayoutAt" in where) {
    const attendu = where.lastPayoutAt as Date | null;
    const actuel = magasin.lastPayoutAt;
    if (attendu === null || actuel === null) {
      if (attendu !== actuel) return false;
    } else if (attendu.getTime() !== actuel.getTime()) {
      return false;
    }
  }
  return true;
}

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    savingsAccount: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updateManyCalls.push(where);
        // L'écriture concurrente s'intercale ici : après la lecture de
        // l'accrual, avant que le filtre ne soit évalué.
        avantEcriture?.();
        avantEcriture = null;
        if (!correspond(where)) return { count: 0 };
        magasin = { ...magasin, ...(data as Partial<Ligne>) };
        return { count: 1 };
      },
      findFirst: async () => ({ ...magasin }),
    },
  };
  return {
    prisma: {
      savingsAccount: {
        findFirst: async () => ({ ...magasin }),
        findMany: async () => [{ ...magasin }],
      },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/app/lib/cash/account-events", () => ({
  recordSavingsAccountInterest: async (
    _tx: unknown,
    _id: string,
    montant: string,
    soldeApres: string
  ) => {
    evenements.push({ type: "INTEREST", montant, soldeApres });
  },
  recordSavingsAccountBalanceChange: async () => undefined,
}));

import { applyDueInterestForSavings } from "@/app/lib/money/savings-accrual";

const IL_Y_A_UN_AN = new Date("2025-03-02T00:00:00.000Z");
const MAINTENANT = new Date("2026-03-02T00:00:00.000Z");

function ligneNeuve(over: Partial<Ligne> = {}): Ligne {
  return {
    id: "s1",
    userId: "u1",
    balance: new Prisma.Decimal("10000"),
    apyPercent: new Prisma.Decimal("3"),
    rateType: "APY",
    payoutFrequency: "YEARLY",
    payoutDayOfWeek: null,
    payoutDayOfMonth: null,
    payoutMonth: null,
    lastPayoutAt: IL_Y_A_UN_AN,
    lastAccruedAt: IL_Y_A_UN_AN,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  magasin = ligneNeuve();
  avantEcriture = null;
  evenements.length = 0;
  updateManyCalls.length = 0;
});

const accrual = () => applyDueInterestForSavings("u1", "s1", MAINTENANT);

describe("accrual sans concurrence", () => {
  it("crédite normalement et inscrit un seul événement", async () => {
    const res = await accrual();
    expect(res?.periodsCredited).toBe(1);
    expect(Number(res?.totalInterest)).toBeCloseTo(300, 6);
    expect(Number(magasin.balance)).toBeCloseTo(10300, 6);
    expect(evenements).toHaveLength(1);
  });

  it("n'écrit rien quand aucun intérêt n'est dû", async () => {
    // Dernier versement d'hier : aucune échéance annuelle entre-temps.
    magasin = ligneNeuve({ lastPayoutAt: new Date("2026-03-01T00:00:00.000Z") });
    const res = await accrual();
    expect(res?.periodsCredited).toBe(0);
    expect(updateManyCalls).toHaveLength(0);
    expect(evenements).toHaveLength(0);
  });

  it("fait avancer lastPayoutAt et lastAccruedAt de façon cohérente", async () => {
    await accrual();
    expect(magasin.lastPayoutAt!.getTime()).toBeGreaterThan(IL_Y_A_UN_AN.getTime());
    expect(magasin.lastAccruedAt.getTime()).toBe(magasin.lastPayoutAt!.getTime());
  });

  it("l'écriture exige l'état qui a servi au calcul", async () => {
    await accrual();
    const where = updateManyCalls[0]!;
    expect(String(where.balance)).toBe("10000");
    expect((where.lastPayoutAt as Date).getTime()).toBe(IL_Y_A_UN_AN.getTime());
  });
});

describe("une saisie utilisateur concurrente n'est jamais écrasée", () => {
  it("le solde saisi survit, l'accrual renonce", async () => {
    /*
      Le scénario exact de l'audit. L'accrual lit 10 000 € et calcule 10 100 €
      (ici 10 300 € au taux du décor). Entre les deux, l'utilisateur saisit
      12 000 € — ce qui, côté API, repositionne aussi `lastPayoutAt`.
    */
    avantEcriture = () => {
      magasin = {
        ...magasin,
        balance: new Prisma.Decimal("12000"),
        lastPayoutAt: MAINTENANT,
        lastAccruedAt: MAINTENANT,
      };
    };

    const res = await accrual();

    expect(Number(magasin.balance)).toBe(12000);
    expect(res).toBeNull();
  });

  it("l'accrual qui perd la course n'inscrit aucun événement INTEREST", async () => {
    avantEcriture = () => {
      magasin = { ...magasin, balance: new Prisma.Decimal("12000") };
    };

    await accrual();
    expect(evenements).toHaveLength(0);
  });

  it("un solde modifié sans que lastPayoutAt bouge est également protégé", async () => {
    /*
      La route de saisie repositionne `lastPayoutAt`, mais le garde-fou ne s'y
      fie pas : c'est le solde qui porte le calcul, donc c'est lui qu'on exige.
    */
    avantEcriture = () => {
      magasin = { ...magasin, balance: new Prisma.Decimal("12000") };
    };

    const res = await accrual();
    expect(res).toBeNull();
    expect(Number(magasin.balance)).toBe(12000);
  });

  it("l'accrual suivant repart proprement du nouvel état", async () => {
    avantEcriture = () => {
      magasin = { ...magasin, balance: new Prisma.Decimal("12000") };
    };
    await accrual();
    expect(evenements).toHaveLength(0);

    // Rien n'est cassé : la ligne accepte le prochain passage, sur 12 000 €.
    const res = await accrual();
    expect(res?.periodsCredited).toBe(1);
    expect(Number(res?.totalInterest)).toBeCloseTo(360, 6);
    expect(Number(magasin.balance)).toBeCloseTo(12360, 6);
    expect(evenements).toHaveLength(1);
  });
});

describe("deux accruals concurrents", () => {
  it("le second ne réinscrit pas un INTEREST pour le même intervalle", async () => {
    /*
      Le premier accrual a déjà crédité la période et fait avancer
      `lastPayoutAt`. Le second, parti du même état lu, se présente ensuite : le
      compare-and-set ne trouve plus sa ligne.

      C'est reproduit ici en jouant le premier accrual dans le crochet du
      second, ce qui place les deux écritures dans l'ordre exact d'une course
      perdue. Deux transactions réellement simultanées ne sont pas
      instrumentables dans un test unitaire ; l'atomicité de l'UPDATE côté base
      couvre ce dernier pas.
    */
    avantEcriture = () => {
      magasin = {
        ...magasin,
        balance: new Prisma.Decimal("10300"),
        lastPayoutAt: new Date("2026-03-02T00:00:00.000Z"),
      };
      evenements.push({ type: "INTEREST", montant: "300", soldeApres: "10300" });
    };

    const res = await accrual();

    expect(res).toBeNull();
    // Un seul événement pour l'intervalle : celui du gagnant.
    expect(evenements).toHaveLength(1);
    expect(Number(magasin.balance)).toBeCloseTo(10300, 6);
  });
});

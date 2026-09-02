import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/lib/prisma-client/client";

/**
 * La matérialisation des échéances ne peut plus écraser un état qu'elle n'a pas lu.
 *
 * La dette est lue hors transaction, les échéances dues sont projetées à partir
 * de `remainingAmount` et `lastPaymentAppliedAt`, puis écrites. Le filtre de
 * l'écriture ne portait que sur l'identité de la ligne : une saisie de capital
 * restant dû arrivant entre les deux était remplacée par un solde calculé sur
 * la valeur périmée, et deux matérialisations concurrentes inscrivaient deux
 * fois les mêmes `LiabilityEvent`.
 *
 * Même correction que pour l'accrual des livrets, et même façon de l'éprouver :
 * la base est simulée par une ligne mutable, et le faux `updateMany` évalue son
 * filtre contre l'état **courant** du magasin. Un crochet interpose une
 * écriture concurrente entre la lecture et l'écriture.
 *
 * Un point propre à ce module est vérifié en plus : les événements sont créés
 * **avant** l'écriture du solde, dans la même transaction. Perdre la course ne
 * doit pas les laisser derrière.
 */

type Dette = {
  id: string;
  userId: string;
  remainingAmount: Prisma.Decimal;
  monthlyPayment: Prisma.Decimal;
  interestRate: Prisma.Decimal | null;
  paymentDay: number;
  startDate: Date;
  endDate: Date | null;
  lastPaymentAppliedAt: Date | null;
};

let magasin: Dette;
let avantEcriture: (() => void) | null = null;
/** Événements réellement validés, c'est-à-dire survivants au commit. */
let evenements: unknown[] = [];
let brouillon: unknown[] = [];

function correspond(where: Record<string, unknown>): boolean {
  if (where.id !== magasin.id || where.userId !== magasin.userId) return false;
  if (where.remainingAmount !== undefined) {
    if (String(where.remainingAmount) !== String(magasin.remainingAmount)) return false;
  }
  if ("lastPaymentAppliedAt" in where) {
    const attendu = where.lastPaymentAppliedAt as Date | null;
    const actuel = magasin.lastPaymentAppliedAt;
    if (attendu === null || actuel === null) {
      if (attendu !== actuel) return false;
    } else if (attendu.getTime() !== actuel.getTime()) return false;
  }
  return true;
}

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    liabilityEvent: {
      create: async ({ data }: { data: unknown }) => {
        brouillon.push(data);
        return data;
      },
    },
    liability: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        avantEcriture?.();
        avantEcriture = null;
        if (!correspond(where)) return { count: 0 };
        magasin = { ...magasin, ...(data as Partial<Dette>) };
        return { count: 1 };
      },
      findFirst: async () => ({ ...magasin }),
    },
  };
  return {
    prisma: {
      liability: { findFirst: async () => ({ ...magasin }) },
      // Le commit ne vaut que si le corps n'a pas levé : c'est ce que
      // reproduit ce `try`.
      $transaction: async (fn: (t: unknown) => unknown) => {
        brouillon = [];
        const out = await fn(tx);
        evenements = [...evenements, ...brouillon];
        return out;
      },
    },
  };
});

import { applyDuePaymentsForLiability } from "@/app/lib/liabilities/service";

const DEBUT = new Date("2025-01-10T00:00:00.000Z");
const MAINTENANT = new Date("2025-04-15T00:00:00.000Z");

function detteNeuve(over: Partial<Dette> = {}): Dette {
  return {
    id: "l1",
    userId: "u1",
    remainingAmount: new Prisma.Decimal("100000"),
    monthlyPayment: new Prisma.Decimal("1000"),
    interestRate: null,
    paymentDay: 10,
    startDate: DEBUT,
    endDate: null,
    lastPaymentAppliedAt: null,
    ...over,
  };
}

beforeEach(() => {
  magasin = detteNeuve();
  avantEcriture = null;
  evenements = [];
  brouillon = [];
});

const materialiser = () =>
  applyDuePaymentsForLiability("u1", "l1", MAINTENANT);

describe("matérialisation sans concurrence", () => {
  it("écrit les échéances dues et avance le solde", async () => {
    const res = await materialiser();
    expect(res).not.toBeNull();
    expect(evenements.length).toBeGreaterThan(0);
    expect(Number(magasin.remainingAmount)).toBeLessThan(100000);
  });

  it("l'écriture exige l'état qui a servi à la projection", async () => {
    /*
      Vérifié par l'effet : une dette dont le solde a changé n'est plus
      reconnue. Sans compare-and-set, le filtre l'accepterait.
    */
    avantEcriture = () => {
      magasin = { ...magasin, remainingAmount: new Prisma.Decimal("42") };
    };
    const res = await materialiser();
    expect(res).toBeNull();
  });

  it("rien de dû : ni écriture, ni événement", async () => {
    magasin = detteNeuve({ lastPaymentAppliedAt: MAINTENANT });
    const res = await materialiser();
    expect(res).not.toBeNull();
    expect(evenements).toHaveLength(0);
  });
});

describe("une saisie utilisateur concurrente n'est jamais écrasée", () => {
  it("le capital restant dû saisi survit", async () => {
    avantEcriture = () => {
      magasin = { ...magasin, remainingAmount: new Prisma.Decimal("50000") };
    };

    const res = await materialiser();

    expect(res).toBeNull();
    expect(Number(magasin.remainingAmount)).toBe(50000);
  });

  it("aucun événement ne subsiste : la transaction entière est abandonnée", async () => {
    /*
      Le point propre à ce module. Les `LiabilityEvent` sont créés avant
      l'écriture du solde ; sortir par un simple `return` les aurait validés,
      laissant une trace comptable d'échéances qui n'ont pas eu lieu.
    */
    avantEcriture = () => {
      magasin = { ...magasin, remainingAmount: new Prisma.Decimal("50000") };
    };

    await materialiser();
    expect(evenements).toHaveLength(0);
  });
});

describe("deux matérialisations concurrentes", () => {
  it("la seconde n'inscrit pas une deuxième fois les mêmes échéances", async () => {
    /*
      La première a déjà écrit : le solde et `lastPaymentAppliedAt` ont avancé.
      La seconde, partie du même état lu, ne retrouve plus sa ligne.

      Elle est jouée ici dans le crochet de la seconde, ce qui place les deux
      écritures dans l'ordre exact d'une course perdue. Deux transactions
      réellement simultanées ne sont pas instrumentables en test unitaire ;
      l'atomicité de l'UPDATE couvre ce dernier pas.
    */
    avantEcriture = () => {
      magasin = {
        ...magasin,
        remainingAmount: new Prisma.Decimal("97000"),
        lastPaymentAppliedAt: new Date("2025-04-10T00:00:00.000Z"),
      };
      evenements = [{ premiere: true }, { premiere: true }, { premiere: true }];
    };

    const res = await materialiser();

    expect(res).toBeNull();
    // Les seuls événements en base sont ceux du gagnant.
    expect(evenements).toHaveLength(3);
  });
});

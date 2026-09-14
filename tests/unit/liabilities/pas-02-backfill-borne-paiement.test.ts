import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/lib/prisma-client/client";

/**
 * PAS-02 — une dette sans borne de paiement ne rejoue pas son historique.
 *
 * PAS-01 pose `lastPaymentAppliedAt` a la creation et a toute resaisie du
 * capital restant du, mais seulement en avant. Les `Liability` deja en base
 * l'ont encore a `null`, et `duePaymentDates` lit cette absence comme « repartir
 * de `startDate` » : la premiere materialisation qui passait dessus ecrivait
 * d'un coup toutes les mensualites depuis l'origine du pret, et amputait le
 * solde d'autant. Des annees d'ecritures datees jamais constatees, sur un solde
 * qui etait deja a jour.
 *
 * Mesure : un pret ouvert en janvier 2020, prelevement le 10, jamais borne, vu
 * le 15 avril 2025. Avant le correctif, la projection rendait 64 echeances.
 * Apres, la borne est posee a `updatedAt` et plus rien n'est du.
 *
 * Le correctif ne reconstitue aucun historique et ne cherche pas a rattraper
 * l'ecart visible sur les donnees de demonstration — defaut de seed connu
 * (D16), hors de ce chantier.
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
  updatedAt: Date;
};

let magasin: Dette;
let evenements: Array<Record<string, unknown>> = [];
/** Prelevements mensuels deja inscrits, vus par la recherche de borne. */
let debitsExistants: Array<{ eventDate: Date }> = [];
/** Toutes les ecritures sur la ligne, filtre compris — l'idempotence se lit la. */
let ecritures: Array<Record<string, unknown>> = [];

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

// Declaration de fonction, et non `const` : la fabrique de `vi.mock` est
// hissee en tete de fichier et ne verrait pas encore la liaison.
async function updateMany({
  where,
  data,
}: {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}) {
  ecritures.push({ where, data });
  if (!correspond(where)) return { count: 0 };
  magasin = { ...magasin, ...(data as Partial<Dette>) };
  return { count: 1 };
}

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    liabilityEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        evenements.push(data);
        return data;
      },
    },
    liability: {
      updateMany,
      findFirst: async () => ({ ...magasin }),
    },
  };
  return {
    prisma: {
      liability: {
        findFirst: async () => ({ ...magasin }),
        findMany: async () =>
          magasin.lastPaymentAppliedAt == null ? [{ ...magasin }] : [],
        updateMany,
      },
      liabilityEvent: {
        findFirst: async () => debitsExistants.at(0) ?? null,
      },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

import {
  applyDuePaymentsForLiability,
} from "@/app/lib/liabilities/service";
import {
  backfillPaymentBaselines,
  paymentBaselineFor,
} from "@/app/lib/liabilities/payment-baseline";
import { projectDuePayments, startOfUtcDay } from "@/app/lib/liabilities/amortization";

/** Pret ouvert il y a cinq ans, jamais borne : la ligne « deja en base ». */
const DEBUT = new Date("2020-01-10T00:00:00.000Z");
/** Derniere ecriture connue sur la ligne — la seule date ou le solde fait foi. */
const MAJ = new Date("2025-03-20T09:41:00.000Z");
const MAINTENANT = new Date("2025-04-15T00:00:00.000Z");

function detteAncienne(over: Partial<Dette> = {}): Dette {
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
    updatedAt: MAJ,
    ...over,
  };
}

beforeEach(() => {
  magasin = detteAncienne();
  evenements = [];
  debitsExistants = [];
  ecritures = [];
});

describe("l'ampleur du rattrapage evite", () => {
  it("sans borne, la projection annonce plus de cinq ans d'echeances", () => {
    /*
      La mesure « avant », prise sur la fonction pure : c'est exactement ce que
      la materialisation aurait ecrit, et le solde qu'elle aurait pose.
    */
    const avant = projectDuePayments({
      remainingAmount: "100000",
      monthlyPayment: "1000",
      paymentDay: 10,
      startDate: DEBUT,
      endDate: null,
      lastPaymentAppliedAt: null,
      interestRate: null,
      now: MAINTENANT,
    });

    expect(avant.payments).toHaveLength(64);
    expect(Number(avant.remaining)).toBe(36000);
  });
});

describe("applyDuePaymentsForLiability sur une dette non bornee", () => {
  it("borne d'abord, puis ne materialise que le mois reellement du", async () => {
    const res = await applyDuePaymentsForLiability("u1", "l1", MAINTENANT);
    expect(res).not.toBeNull();

    /*
      Avant le correctif : 64 `LiabilityEvent` d'un coup et un solde ramene a
      36 000 €. La borne est posee au 20 mars — derniere date ou le solde fasse
      foi — et le prelevement tombe le 10 : la seule echeance survenue depuis
      est celle du 10 avril. Cinq ans d'historique ne sont pas inventes, et le
      mois reellement du n'est pas perdu pour autant.
    */
    expect(evenements).toHaveLength(1);
    expect((evenements[0]!.eventDate as Date).toISOString().slice(0, 10)).toBe(
      "2025-04-10"
    );
    expect(Number(magasin.remainingAmount)).toBe(99000);

    // Deux ecritures, et deux seulement : la pose de la borne, puis la
    // materialisation ordinaire qui repart d'elle.
    expect(ecritures).toHaveLength(2);
    expect(
      (ecritures[0]!.where as Record<string, unknown>).lastPaymentAppliedAt
    ).toBeNull();
    expect(
      (ecritures[0]!.data as Record<string, unknown>).lastPaymentAppliedAt
    ).toEqual(startOfUtcDay(MAJ));
  });

  it("rejouee, elle ne materialise plus rien", async () => {
    await applyDuePaymentsForLiability("u1", "l1", MAINTENANT);
    evenements = [];

    await applyDuePaymentsForLiability("u1", "l1", MAINTENANT);

    expect(evenements).toHaveLength(0);
    expect(Number(magasin.remainingAmount)).toBe(99000);
  });

  it("rejouee, la pose de borne n'ecrit plus rien", async () => {
    await applyDuePaymentsForLiability("u1", "l1", MAINTENANT);
    const borne = magasin.lastPaymentAppliedAt;
    ecritures = [];

    await applyDuePaymentsForLiability("u1", "l1", MAINTENANT);
    await applyDuePaymentsForLiability("u1", "l1", MAINTENANT);

    // Seules les ecritures de materialisation ordinaire subsistent : aucune ne
    // porte le filtre `lastPaymentAppliedAt: null` de la pose de borne.
    expect(
      ecritures.filter(
        (e) => (e.where as Record<string, unknown>).lastPaymentAppliedAt === null
      )
    ).toHaveLength(0);
    expect(magasin.lastPaymentAppliedAt).toEqual(borne);
  });
});

describe("choix de la date de reference", () => {
  it("par defaut, la derniere ecriture de la ligne", () => {
    expect(paymentBaselineFor({ id: "l1", lastPaymentAppliedAt: null, updatedAt: MAJ }, null))
      .toEqual(startOfUtcDay(MAJ));
  });

  it("un prelevement deja inscrit plus recent fait foi", () => {
    /*
      Un seed qui cree ses evenements apres la dette laisse `updatedAt` en
      arriere. S'en tenir a lui rejouerait les mois qui les separent : on retient
      la plus recente des deux dates connues.
    */
    const debit = new Date("2025-04-10T12:00:00.000Z");
    expect(
      paymentBaselineFor({ id: "l1", lastPaymentAppliedAt: null, updatedAt: MAJ }, debit)
    ).toEqual(startOfUtcDay(debit));
  });

  it("un prelevement plus ancien ne recule pas la borne", () => {
    const debit = new Date("2021-06-10T12:00:00.000Z");
    expect(
      paymentBaselineFor({ id: "l1", lastPaymentAppliedAt: null, updatedAt: MAJ }, debit)
    ).toEqual(startOfUtcDay(MAJ));
  });

  it("le dernier prelevement inscrit est consulte sur le chemin d'ecriture", async () => {
    debitsExistants = [{ eventDate: new Date("2025-04-10T12:00:00.000Z") }];

    await applyDuePaymentsForLiability("u1", "l1", MAINTENANT);

    expect(magasin.lastPaymentAppliedAt).toEqual(
      startOfUtcDay(new Date("2025-04-10T12:00:00.000Z"))
    );
    expect(evenements).toHaveLength(0);
  });
});

describe("balayage a l'echelle d'un compte", () => {
  it("borne les lignes sans reference, sans creer d'evenement", async () => {
    const bornees = await backfillPaymentBaselines("u1");

    expect(bornees).toBe(1);
    expect(evenements).toHaveLength(0);
    expect(magasin.lastPaymentAppliedAt).toEqual(startOfUtcDay(MAJ));
  });

  it("relance : plus aucune ligne a borner", async () => {
    await backfillPaymentBaselines("u1");
    ecritures = [];

    expect(await backfillPaymentBaselines("u1")).toBe(0);
    expect(ecritures).toHaveLength(0);
  });
});

/**
 * Génération des loyers et charges récurrents d'un bien locatif.
 *
 * Le calcul d'échéances est celui des passifs (`duePaymentDates`) : même jour du
 * mois, même curseur de reprise, mêmes bornes de début et de fin. Écrire un
 * second planificateur aurait garanti qu'ils divergent — sur les mois courts,
 * les rattrapages ou les changements de jour.
 *
 * ## Écritures en attente, pas directes
 *
 * Une échéance générée est une **proposition**, pas un encaissement. Créer un
 * `LOYER` de plein droit gonflerait la trésorerie affichée avec de l'argent
 * jamais reçu : un locataire peut payer en retard, partiellement, ou pas du
 * tout. L'utilisateur confirme, et c'est la confirmation qui écrit au journal.
 *
 * Le curseur (`lastRentAppliedAt`) n'avance donc qu'à la confirmation. Une
 * échéance ignorée reste proposée au passage suivant plutôt que de disparaître
 * silencieusement.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { duePaymentDates, dateKey } from "../liabilities/amortization";
import { createTransaction } from "../transactions/service";
import { isRentalUsage } from "./constants";

/** Marqueur porté par les notes, pour reconnaître une échéance déjà écrite. */
export const RENT_NOTE_PREFIX = "[loyer:";
export const CHARGES_NOTE_PREFIX = "[charges:";

export type PendingEntry = {
  assetId: string;
  propertyName: string;
  /** LOYER ou FRAIS */
  kind: "RENT" | "CHARGES";
  dueDate: string;
  amountEur: string;
  /** Note qui sera portée par la transaction — sert aussi de clé d'unicité. */
  note: string;
};

/**
 * Marqueur d'échéance, unique par bien et par date.
 *
 * L'identifiant du bien en fait partie parce que le contrôle de doublon ne peut
 * pas s'appuyer sur `assetId` : une charge est enregistrée en `FRAIS` **sans
 * actif** (c'est une dépense bancaire, pas un mouvement de position). Sans cette
 * clé, deux biens dont les charges tombent le même jour se confondraient — et
 * reconfirmer un mois déjà écrit en créerait un doublon.
 */
function noteFor(kind: "RENT" | "CHARGES", due: Date, assetId: string): string {
  const prefix = kind === "RENT" ? RENT_NOTE_PREFIX : CHARGES_NOTE_PREFIX;
  return `${prefix}${dateKey(due)}:${assetId}]`;
}

type ScheduleRow = {
  assetId: string;
  usage: string;
  rentDay: number | null;
  monthlyRentEur: { toString(): string } | null;
  monthlyChargesEur: { toString(): string } | null;
  annualPropertyTaxEur: { toString(): string } | null;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
  lastRentAppliedAt: Date | null;
  lastChargesAppliedAt: Date | null;
  asset: { name: string; platformId: string };
};

/**
 * Échéances dues et non encore écrites, tous biens locatifs confondus.
 *
 * Rien n'est enregistré ici : la fonction ne fait que proposer.
 */
export async function listPendingEntries(
  userId: string,
  opts?: { now?: Date }
): Promise<PendingEntry[]> {
  const now = opts?.now ?? new Date();

  const rows = (await prisma.realEstateDetail.findMany({
    where: {
      asset: { is: { userId } },
      rentDay: { not: null },
    },
    select: {
      assetId: true,
      usage: true,
      rentDay: true,
      monthlyRentEur: true,
      monthlyChargesEur: true,
      annualPropertyTaxEur: true,
      rentalStartDate: true,
      rentalEndDate: true,
      lastRentAppliedAt: true,
      lastChargesAppliedAt: true,
      asset: { select: { name: true, platformId: true } },
    },
  })) as ScheduleRow[];

  const pending: PendingEntry[] = [];

  for (const row of rows) {
    // Une résidence principale n'a pas de loyer à encaisser, même si les
    // champs ont été renseignés par erreur.
    if (!isRentalUsage(row.usage) || row.rentDay == null) continue;

    const rent = row.monthlyRentEur ? d(row.monthlyRentEur.toString()) : d(0);
    const charges = row.monthlyChargesEur
      ? d(row.monthlyChargesEur.toString())
      : d(0);

    if (rent.gt(0)) {
      for (const due of duePaymentDates({
        paymentDay: row.rentDay,
        startDate: row.rentalStartDate,
        endDate: row.rentalEndDate,
        lastPaymentAppliedAt: row.lastRentAppliedAt,
        now,
      })) {
        pending.push({
          assetId: row.assetId,
          propertyName: row.asset.name,
          kind: "RENT",
          dueDate: due.toISOString(),
          amountEur: rent.toFixed(2),
          note: noteFor("RENT", due, row.assetId),
        });
      }
    }

    if (charges.gt(0)) {
      for (const due of duePaymentDates({
        paymentDay: row.rentDay,
        startDate: row.rentalStartDate,
        endDate: row.rentalEndDate,
        lastPaymentAppliedAt: row.lastChargesAppliedAt,
        now,
      })) {
        pending.push({
          assetId: row.assetId,
          propertyName: row.asset.name,
          kind: "CHARGES",
          dueDate: due.toISOString(),
          amountEur: charges.toFixed(2),
          note: noteFor("CHARGES", due, row.assetId),
        });
      }
    }
  }

  pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return pending;
}

export type ConfirmResult = {
  created: number;
  skipped: number;
  errors: string[];
};

/**
 * Écrit au journal les échéances confirmées par l'utilisateur.
 *
 * Une échéance déjà présente est ignorée plutôt que dupliquée : le marqueur
 * porté par les notes sert de clé. Deux confirmations successives du même mois
 * ne créent donc qu'une écriture.
 *
 * Le curseur n'avance que sur ce qui a réellement été écrit — une échéance
 * qu'on choisit de ne pas confirmer restera proposée.
 */
export async function confirmEntries(
  userId: string,
  entries: Array<{ assetId: string; kind: "RENT" | "CHARGES"; dueDate: string }>
): Promise<ConfirmResult> {
  const result: ConfirmResult = { created: 0, skipped: 0, errors: [] };

  for (const entry of entries) {
    const detail = await prisma.realEstateDetail.findFirst({
      where: { assetId: entry.assetId, asset: { is: { userId } } },
      select: {
        assetId: true,
        usage: true,
        monthlyRentEur: true,
        monthlyChargesEur: true,
        lastRentAppliedAt: true,
        lastChargesAppliedAt: true,
        asset: { select: { name: true, platformId: true } },
      },
    });
    if (!detail) {
      result.errors.push(`Bien introuvable (${entry.assetId})`);
      continue;
    }

    const due = new Date(entry.dueDate);
    if (Number.isNaN(due.getTime())) {
      result.errors.push(`Date d'échéance invalide (${entry.dueDate})`);
      continue;
    }

    const note = noteFor(entry.kind, due, entry.assetId);
    // Recherche sur la seule note : les charges n'ont pas d'actif rattaché,
    // filtrer sur `assetId` les rendrait invisibles au contrôle de doublon.
    const already = await prisma.transaction.findFirst({
      where: { userId, notes: { contains: note } },
      select: { id: true },
    });
    if (already) {
      result.skipped++;
      continue;
    }

    const amount =
      entry.kind === "RENT"
        ? detail.monthlyRentEur
          ? d(detail.monthlyRentEur.toString())
          : d(0)
        : detail.monthlyChargesEur
          ? d(detail.monthlyChargesEur.toString())
          : d(0);

    if (amount.lte(0)) {
      result.errors.push(`Montant non renseigné pour ${detail.asset.name}`);
      continue;
    }

    try {
      await createTransaction({
        userId,
        // Un loyer est un revenu rattaché au bien ; les charges sont une
        // dépense bancaire, sans lien de position — d'où l'absence d'assetId.
        type: entry.kind === "RENT" ? "LOYER" : "FRAIS",
        platformId: detail.asset.platformId,
        assetId: entry.kind === "RENT" ? entry.assetId : null,
        cashAmount: amount.toFixed(2),
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: due.toISOString(),
        allowNegativeCash: true,
        notes: `${note} ${detail.asset.name}`,
      } as Parameters<typeof createTransaction>[0]);

      await prisma.realEstateDetail.update({
        where: { assetId: entry.assetId },
        data:
          entry.kind === "RENT"
            ? { lastRentAppliedAt: due }
            : { lastChargesAppliedAt: due },
      });
      result.created++;
    } catch (e) {
      result.errors.push(
        `${detail.asset.name} : ${e instanceof Error ? e.message : "échec"}`
      );
    }
  }

  return result;
}

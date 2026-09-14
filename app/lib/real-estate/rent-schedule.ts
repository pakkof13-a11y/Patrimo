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
 *
 * ## Le curseur ne saute jamais un trou (IMM-03)
 *
 * `duePaymentDates` (partagé avec les crédits) ne relit jamais ce qui précède
 * le curseur — c'est la moitié basse du contrat : il ne reproduit pas deux
 * fois une échéance déjà appliquée. La moitié haute, propre au loyer, doit
 * être tenue ici : le curseur ne doit avancer que sur une suite *continue*
 * d'échéances honorées (confirmées, ou déjà écrites au journal). Confirmer
 * juin, août et septembre en laissant juillet décoché ne doit jamais faire
 * passer le curseur à septembre — juillet, invisible pour `duePaymentDates`
 * une fois le curseur derrière lui, disparaîtrait pour toujours des
 * propositions. `advanceCursor` recalcule donc le curseur après coup, à
 * partir de sa valeur d'avant l'appel, et s'arrête à la première échéance ni
 * confirmée ni déjà écrite.
 *
 * Corollaire côté lecture : tant qu'un trou retient le curseur en arrière,
 * des échéances déjà honorées et postérieures au trou redeviennent
 * candidates pour `duePaymentDates`. `listPendingEntries` les exclut donc en
 * vérifiant, pour chacune, qu'aucune transaction n'a déjà été écrite —
 * `writtenDueDateKeys` sert les deux sens de cette vérification.
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

/**
 * Dates (au format `dateKey`) déjà écrites au journal pour un bien et une
 * nature d'échéance donnés.
 *
 * Sert deux besoins liés au trou que le curseur peut laisser derrière lui
 * (voir l'en-tête du module) :
 *  - `listPendingEntries` s'en sert pour ne pas reproposer une échéance déjà
 *    honorée dont le curseur n'a pas encore pu franchir le trou qui la
 *    précède ;
 *  - `advanceCursor` s'en sert pour reconnaître qu'une échéance antérieure au
 *    lot en cours de confirmation a déjà été écrite (par un appel précédent).
 *
 * Une seule requête par (bien, nature), sur le marqueur porté par les notes —
 * la même clé que `noteFor`/le contrôle de doublon de `confirmEntries`.
 */
async function writtenDueDateKeys(
  userId: string,
  assetId: string,
  kind: "RENT" | "CHARGES"
): Promise<Set<string>> {
  const prefix = kind === "RENT" ? RENT_NOTE_PREFIX : CHARGES_NOTE_PREFIX;
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      notes: { contains: prefix },
      AND: [{ notes: { contains: `:${assetId}]` } }],
    },
    select: { notes: true },
  });
  const keys = new Set<string>();
  for (const row of rows) {
    const match = row.notes?.match(/:(\d{4}-\d{2}-\d{2}):/);
    if (match) keys.add(match[1]);
  }
  return keys;
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
      const rentDates = duePaymentDates({
        paymentDay: row.rentDay,
        startDate: row.rentalStartDate,
        endDate: row.rentalEndDate,
        lastPaymentAppliedAt: row.lastRentAppliedAt,
        now,
      });
      if (rentDates.length > 0) {
        // Un trou plus ancien peut retenir le curseur en arrière (voir
        // l'en-tête du module) : sans ce filtre, une échéance postérieure
        // déjà honorée redeviendrait candidate à chaque lecture.
        const written = await writtenDueDateKeys(userId, row.assetId, "RENT");
        for (const due of rentDates) {
          if (written.has(dateKey(due))) continue;
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
    }

    if (charges.gt(0)) {
      const chargesDates = duePaymentDates({
        paymentDay: row.rentDay,
        startDate: row.rentalStartDate,
        endDate: row.rentalEndDate,
        lastPaymentAppliedAt: row.lastChargesAppliedAt,
        now,
      });
      if (chargesDates.length > 0) {
        const written = await writtenDueDateKeys(userId, row.assetId, "CHARGES");
        for (const due of chargesDates) {
          if (written.has(dateKey(due))) continue;
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
  }

  pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return pending;
}

export type ConfirmResult = {
  created: number;
  skipped: number;
  errors: string[];
};

/** Ce qu'il faut connaître d'un bien pour rejouer son échéancier. */
type ScheduleShape = {
  rentDay: number | null;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
};

/**
 * Recalcule le curseur d'un (bien, nature) après un lot de confirmations.
 *
 * Repart de la valeur du curseur **avant** cet appel (pas de celle, possiblement
 * déjà en base, d'une confirmation antérieure au sein du même lot — il n'y en a
 * pas, `confirmEntries` ne touche plus le curseur avant d'appeler ceci) et
 * avance, échéance après échéance, tant que chacune est honorée : confirmée
 * dans ce lot, ou déjà écrite au journal par un appel précédent. La première
 * échéance ni confirmée ni déjà écrite arrête l'avancée — elle reste due, et
 * tout ce qui la suit dans ce lot aussi, même si `createTransaction` a réussi
 * pour elles : la transaction reste écrite (pas de doublon au prochain essai),
 * seul le curseur ne bouge pas au-delà du trou.
 */
async function advanceCursor(
  userId: string,
  assetId: string,
  kind: "RENT" | "CHARGES",
  schedule: ScheduleShape,
  oldCursor: Date | null,
  confirmedInThisBatch: Set<string>,
  now: Date
): Promise<void> {
  if (schedule.rentDay == null) return;

  const candidates = duePaymentDates({
    paymentDay: schedule.rentDay,
    startDate: schedule.rentalStartDate,
    endDate: schedule.rentalEndDate,
    lastPaymentAppliedAt: oldCursor,
    now,
  });
  if (candidates.length === 0) return;

  const written = await writtenDueDateKeys(userId, assetId, kind);

  let newCursor: Date | null = oldCursor;
  for (const candidate of candidates) {
    const key = dateKey(candidate);
    const honored = confirmedInThisBatch.has(key) || written.has(key);
    if (!honored) break; // Échéance ignorée : le curseur s'arrête ici.
    newCursor = candidate;
  }

  if (newCursor && (!oldCursor || newCursor.getTime() > oldCursor.getTime())) {
    await prisma.realEstateDetail.update({
      where: { assetId },
      data:
        kind === "RENT"
          ? { lastRentAppliedAt: newCursor }
          : { lastChargesAppliedAt: newCursor },
    });
  }
}

/**
 * Écrit au journal les échéances confirmées par l'utilisateur.
 *
 * Une échéance déjà présente est ignorée plutôt que dupliquée : le marqueur
 * porté par les notes sert de clé. Deux confirmations successives du même mois
 * ne créent donc qu'une écriture.
 *
 * Le curseur n'avance que sur ce qui a réellement été écrit — une échéance
 * qu'on choisit de ne pas confirmer restera proposée. Voir l'en-tête du
 * module (IMM-03) : avancer le curseur à la date de chaque échéance confirmée,
 * sans égard pour un trou laissé par une échéance ignorée plus tôt dans le
 * lot, ferait disparaître ce trou des propositions futures. Le curseur n'est
 * donc plus mis à jour entrée par entrée : il est recalculé une fois par
 * (bien, nature) après coup, par `advanceCursor`.
 */
export async function confirmEntries(
  userId: string,
  entries: Array<{ assetId: string; kind: "RENT" | "CHARGES"; dueDate: string }>,
  opts?: { now?: Date }
): Promise<ConfirmResult> {
  const now = opts?.now ?? new Date();
  const result: ConfirmResult = { created: 0, skipped: 0, errors: [] };

  // Par (bien, nature) : schéma pour rejouer les échéances, curseur d'avant
  // ce lot, et dates honorées dans ce lot — de quoi recalculer le curseur une
  // fois toutes les entrées traitées.
  const groups = new Map<
    string,
    {
      assetId: string;
      kind: "RENT" | "CHARGES";
      schedule: ScheduleShape;
      oldCursor: Date | null;
      confirmedKeys: Set<string>;
    }
  >();

  for (const entry of entries) {
    const detail = await prisma.realEstateDetail.findFirst({
      where: { assetId: entry.assetId, asset: { is: { userId } } },
      select: {
        assetId: true,
        usage: true,
        rentDay: true,
        rentalStartDate: true,
        rentalEndDate: true,
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

    const groupKey = `${entry.assetId}|${entry.kind}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        assetId: entry.assetId,
        kind: entry.kind,
        schedule: {
          rentDay: detail.rentDay,
          rentalStartDate: detail.rentalStartDate,
          rentalEndDate: detail.rentalEndDate,
        },
        oldCursor:
          entry.kind === "RENT" ? detail.lastRentAppliedAt : detail.lastChargesAppliedAt,
        confirmedKeys: new Set<string>(),
      });
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
      // Déjà écrite : elle compte comme honorée pour le recalcul du curseur.
      groups.get(groupKey)!.confirmedKeys.add(dateKey(due));
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

      groups.get(groupKey)!.confirmedKeys.add(dateKey(due));
      result.created++;
    } catch (e) {
      result.errors.push(
        `${detail.asset.name} : ${e instanceof Error ? e.message : "échec"}`
      );
    }
  }

  for (const group of groups.values()) {
    if (group.confirmedKeys.size === 0) continue;
    await advanceCursor(
      userId,
      group.assetId,
      group.kind,
      group.schedule,
      group.oldCursor,
      group.confirmedKeys,
      now
    );
  }

  return result;
}

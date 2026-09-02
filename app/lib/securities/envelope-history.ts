/**
 * Journal des enveloppes fiscales — écriture et résolution.
 *
 * ## La question à laquelle ce module répond
 *
 * « À quelle enveloppe cette ligne appartenait-elle le 12 mars 2025 ? »
 *
 * `Asset.accountType` ne peut pas y répondre : il décrit l'état **courant**,
 * il est mutable, et il ne garde aucune trace. Une ligne passée du CTO au PEA
 * paraissait, hier encore, avoir toujours été PEA — et une courbe historique
 * par enveloppe bâtie là-dessus aurait réécrit le passé à chaque reclassement.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne reconstruit rien. Une date antérieure au premier événement d'une ligne
 * rend `UNKNOWN`, et c'est la réponse juste : `createdAt` mesure l'écriture en
 * base, pas l'entrée dans l'enveloppe. Sur le compte de démonstration, les
 * seize lignes titres portent un `createdAt` de 2026 alors que leurs premières
 * opérations remontent à 2023 — dater un événement ainsi aurait affirmé une
 * appartenance que rien ne démontre.
 *
 * Mieux vaut « je ne sais pas » qu'une enveloppe plausible.
 *
 * ## Deux natures d'événement
 *
 * `OBSERVED` constate un état à une date, sans rien dire d'avant. C'est le
 * premier point de toute ligne antérieure au journal, et celui posé à la
 * création d'une ligne — où la date d'entrée dans l'enveloppe *est* connue.
 *
 * `CHANGED` enregistre une mutation réellement survenue.
 *
 * La distinction compte pour le futur chantier des courbes : elle lui dit
 * quelles périodes sont démontrées et lesquelles ne le sont pas.
 */

import type { Prisma, PrismaClient } from "@/app/lib/prisma-client/client";
import { accountTypeForEnvelope, isSecuritiesEnvelopeType } from "./constants";

/**
 * Ce qu'une ligne occupait à une date.
 *
 * `UNATTACHED` et `UNKNOWN` ne se confondent pas : la première dit « on sait
 * qu'elle n'était rattachée à aucun compte », la seconde « on ne sait rien ».
 * Les fondre ferait passer une ignorance pour un constat.
 */
export type ResolvedEnvelope =
  | "PEA"
  | "PEA_PME"
  | "CTO"
  | "UNATTACHED"
  | "UNKNOWN";

export type EnvelopeEventKind = "OBSERVED" | "CHANGED";

/** L'état d'enveloppe d'une ligne, tel qu'on l'enregistre. */
export type EnvelopeState = {
  accountType: string;
  securitiesAccountId: string | null;
  /** Type du compte — dénormalisé pour survivre à sa suppression. */
  envelopeType: string | null;
};

/** Un client Prisma ou une transaction : l'écriture doit pouvoir s'y joindre. */
type Writer = Pick<PrismaClient, "assetEnvelopeEvent"> | Prisma.TransactionClient;

/**
 * Enregistre un événement d'enveloppe.
 *
 * `occurredAt` est la date **métier**, distincte de l'horodatage d'écriture :
 * deux événements écrits dans la même milliseconde restent ordonnés par ce
 * qu'ils décrivent, pas par la vitesse du disque.
 *
 * Le paramètre `writer` accepte une transaction. C'est la raison d'être de sa
 * signature : la mutation de l'état courant et sa journalisation doivent
 * réussir ou échouer ensemble, sans quoi le journal finirait par décrire une
 * histoire que l'état courant contredit.
 */
export async function recordEnvelopeEvent(
  writer: Writer,
  input: {
    assetId: string;
    userId: string;
    kind: EnvelopeEventKind;
    state: EnvelopeState;
    occurredAt?: Date;
  }
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();

  await writer.assetEnvelopeEvent.create({
    data: {
      assetId: input.assetId,
      userId: input.userId,
      occurredAt,
      kind: input.kind,
      accountType: input.state.accountType,
      securitiesAccountId: input.state.securitiesAccountId,
      envelopeType: input.state.envelopeType,
    },
  });
}

/**
 * Traduit un événement en enveloppe résolue.
 *
 * L'ordre de lecture n'est pas indifférent. Le **compte** fait foi quand il
 * existe : il distingue un PEA d'un PEA-PME, ce que `accountType` ne sait pas
 * faire — les deux plans partagent la famille fiscale `PEA`. Sans compte, on
 * retombe sur la famille, qui reste une information vraie.
 */
export function envelopeOfEvent(event: {
  accountType: string;
  securitiesAccountId: string | null;
  envelopeType: string | null;
}): ResolvedEnvelope {
  if (event.securitiesAccountId && event.envelopeType) {
    if (isSecuritiesEnvelopeType(event.envelopeType)) return event.envelopeType;
    /*
      Compte d'un type inconnu — une valeur héritée, par exemple. On ne devine
      pas : la famille fiscale de la ligne reste connue, et c'est tout ce qu'on
      peut affirmer.
    */
  }

  if (event.accountType === "PEA") return "PEA";
  if (event.accountType === "CTO") return "CTO";

  /*
    La ligne a quitté les enveloppes titres — devenue AV, CRYPTO, IMMOBILIER.
    Elle n'est plus rattachée à un compte titres, et le dire est exact.
  */
  return "UNATTACHED";
}

/**
 * L'enveloppe d'une ligne à une date, ou `UNKNOWN`.
 *
 * Le dernier événement **antérieur ou égal** à la date demandée fait foi : une
 * enveloppe reste celle qu'elle était jusqu'à ce qu'un événement dise le
 * contraire. Aucun événement antérieur signifie qu'aucune donnée ne couvre
 * cette date — jamais que la ligne valait son état actuel.
 *
 * Une date tombant exactement sur un événement prend cet événement : le
 * changement vaut à partir de l'instant qu'il porte, pas après.
 */
export function resolveEnvelopeFromEvents(
  events: ReadonlyArray<{
    occurredAt: Date;
    accountType: string;
    securitiesAccountId: string | null;
    envelopeType: string | null;
  }>,
  at: Date
): ResolvedEnvelope {
  let retenu: (typeof events)[number] | null = null;

  for (const e of events) {
    if (e.occurredAt.getTime() > at.getTime()) continue;
    /*
      Le plus récent l'emporte. La comparaison porte sur `occurredAt` et non
      sur l'ordre d'insertion : deux événements saisis dans le désordre
      restent lus dans l'ordre de ce qu'ils décrivent.
    */
    if (retenu == null || e.occurredAt.getTime() >= retenu.occurredAt.getTime()) {
      retenu = e;
    }
  }

  if (retenu == null) return "UNKNOWN";
  return envelopeOfEvent(retenu);
}

/**
 * Résout l'enveloppe d'une ligne à une date, en lisant le journal.
 *
 * Lecture pure : aucune écriture, aucun appel réseau. Le futur chantier des
 * courbes s'y branchera ; rien ne l'y branche encore.
 */
export async function resolveEnvelopeAt(
  reader: Pick<PrismaClient, "assetEnvelopeEvent">,
  assetId: string,
  at: Date
): Promise<ResolvedEnvelope> {
  const events = await reader.assetEnvelopeEvent.findMany({
    where: { assetId, occurredAt: { lte: at } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: {
      occurredAt: true,
      accountType: true,
      securitiesAccountId: true,
      envelopeType: true,
    },
  });

  const dernier = events[0];
  return dernier ? envelopeOfEvent(dernier) : "UNKNOWN";
}

/**
 * L'état à journaliser après un rattachement ou un détachement.
 *
 * Rassemblé ici pour que les appelants n'aient pas à reconstruire eux-mêmes
 * le triplet — trois endroits qui le composeraient à la main finiraient par
 * en composer trois versions.
 */
export function stateAfterAttachment(
  accountType: string,
  account: { id: string; envelopeType: string } | null
): EnvelopeState {
  return {
    accountType,
    securitiesAccountId: account?.id ?? null,
    envelopeType: account?.envelopeType ?? null,
  };
}

/**
 * Famille fiscale portée par un compte, ou `null` s'il n'y en a pas.
 *
 * Réexporté depuis `constants` plutôt que redéfini : la correspondance entre
 * un type de compte et sa famille fiscale n'a qu'une seule définition dans ce
 * dépôt, et ce module n'en introduit pas une seconde.
 */
export function familyOfAccount(envelopeType: string | null): "PEA" | "CTO" | null {
  if (!envelopeType || !isSecuritiesEnvelopeType(envelopeType)) return null;
  return accountTypeForEnvelope(envelopeType);
}

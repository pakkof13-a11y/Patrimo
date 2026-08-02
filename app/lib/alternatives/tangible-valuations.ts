/**
 * Revalorisations d'un objet tangible — service.
 *
 * Une montre ou une œuvre ne cote pas : leur valeur ne se rafraîchit pas, elle
 * se **constate**, à intervalles irréguliers, par une expertise ou une vente
 * comparable. Ce service enregistre ces constats datés et tient à jour la
 * valeur courante de l'objet, de sorte que le patrimoine reflète la dernière
 * estimation connue plutôt qu'un chiffre saisi une fois puis oublié.
 */

import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/lib/prisma-client/client";
import {
  buildValuationTimeline,
  VALUATION_SOURCES,
  type ValuationSource,
  type ValuationTimeline,
} from "@/app/lib/tangibles/valuation-history";

export class TangibleValuationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TangibleValuationError";
  }
}

export type TangibleValuationDto = {
  id: string;
  valuedAt: string;
  valueEur: string;
  source: ValuationSource;
  note: string | null;
};

function isSource(v: string): v is ValuationSource {
  return (VALUATION_SOURCES as readonly string[]).includes(v);
}

async function ownedTangible(userId: string, tangibleId: string) {
  const row = await prisma.tangibleAsset.findFirst({
    where: { id: tangibleId, userId },
    select: {
      id: true,
      purchasePrice: true,
      acquisitionFees: true,
      purchaseDate: true,
    },
  });
  if (!row) {
    throw new TangibleValuationError("NOT_FOUND", "Objet introuvable");
  }
  return row;
}

/** Valorisations d'un objet, de la plus ancienne à la plus récente. */
export async function listValuations(
  userId: string,
  tangibleId: string
): Promise<{ valuations: TangibleValuationDto[]; timeline: ValuationTimeline }> {
  const tangible = await ownedTangible(userId, tangibleId);
  const rows = await prisma.tangibleValuation.findMany({
    where: { tangibleId, userId },
    orderBy: { valuedAt: "asc" },
  });

  const valuations = rows.map((r) => ({
    id: r.id,
    valuedAt: r.valuedAt.toISOString(),
    valueEur: r.valueEur.toString(),
    source: (isSource(r.source) ? r.source : "MANUAL") as ValuationSource,
    note: r.note,
  }));

  return {
    valuations,
    timeline: buildValuationTimeline({
      purchasePriceEur: tangible.purchasePrice.toString(),
      acquisitionFeesEur: tangible.acquisitionFees?.toString() ?? null,
      purchaseDate: tangible.purchaseDate,
      valuations,
    }),
  };
}

/**
 * Enregistre une valorisation, et aligne la valeur courante de l'objet.
 *
 * L'alignement n'a lieu que si la nouvelle valorisation est la plus récente :
 * saisir après coup une expertise de 2019 documente le passé, elle ne doit pas
 * faire reculer la valeur d'aujourd'hui. Les deux écritures sont dans une même
 * transaction — un objet dont la valeur affichée ne correspond à aucune de ses
 * valorisations serait pire que pas d'historique du tout.
 */
export async function addValuation(
  userId: string,
  tangibleId: string,
  input: { valuedAt: string; valueEur: string | number; source?: string; note?: string | null }
): Promise<TangibleValuationDto> {
  await ownedTangible(userId, tangibleId);

  const valuedAt = new Date(input.valuedAt);
  if (Number.isNaN(valuedAt.getTime())) {
    throw new TangibleValuationError("INVALID_DATE", "Date de valorisation invalide");
  }
  if (valuedAt.getTime() > Date.now() + 24 * 3600_000) {
    throw new TangibleValuationError(
      "FUTURE_DATE",
      "Une valorisation ne peut pas être constatée dans le futur"
    );
  }

  const value = new Prisma.Decimal(String(input.valueEur));
  if (!value.greaterThan(0)) {
    throw new TangibleValuationError(
      "INVALID_VALUE",
      "La valeur doit être strictement positive"
    );
  }

  const source: ValuationSource =
    input.source && isSource(input.source) ? input.source : "MANUAL";

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.tangibleValuation.create({
      data: {
        tangibleId,
        userId,
        valuedAt,
        valueEur: value,
        source,
        note: input.note?.trim() || null,
      },
    });

    const latest = await tx.tangibleValuation.findFirst({
      where: { tangibleId, userId },
      orderBy: { valuedAt: "desc" },
      select: { id: true, valueEur: true },
    });
    if (latest?.id === row.id) {
      await tx.tangibleAsset.update({
        where: { id: tangibleId },
        data: { estimatedValue: value },
      });
    }

    return row;
  });

  return {
    id: created.id,
    valuedAt: created.valuedAt.toISOString(),
    valueEur: created.valueEur.toString(),
    source,
    note: created.note,
  };
}

/**
 * Supprime une valorisation et réaligne la valeur courante sur celle qui
 * devient la plus récente — ou sur le prix d'achat s'il n'en reste aucune.
 */
export async function deleteValuation(
  userId: string,
  tangibleId: string,
  valuationId: string
): Promise<void> {
  const tangible = await ownedTangible(userId, tangibleId);

  await prisma.$transaction(async (tx) => {
    const removed = await tx.tangibleValuation.deleteMany({
      where: { id: valuationId, tangibleId, userId },
    });
    if (removed.count === 0) {
      throw new TangibleValuationError("NOT_FOUND", "Valorisation introuvable");
    }

    const latest = await tx.tangibleValuation.findFirst({
      where: { tangibleId, userId },
      orderBy: { valuedAt: "desc" },
      select: { valueEur: true },
    });

    await tx.tangibleAsset.update({
      where: { id: tangibleId },
      data: { estimatedValue: latest?.valueEur ?? tangible.purchasePrice },
    });
  });
}

/**
 * CRUD `DefiStrategy` — regroupement optionnel de positions DeFi liées.
 *
 * Une stratégie n'est qu'une étiquette de rattachement : elle ne porte aucune
 * valeur propre (`groupByStrategy`/`summarizeStrategy` dans `defi.ts` la
 * recalculent depuis les positions), donc la supprimer ne perd aucune donnée
 * financière — seules les positions rattachées perdent leur regroupement
 * (`onDelete: SetNull` en base, cf. la migration).
 */

import { prisma } from "../prisma";
import { owned, wroteOne } from "../db/tenant-scope";
import { DefiInputError } from "./defi-manual-service";

export type DefiStrategySummary = {
  id: string;
  name: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function trimmedName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new DefiInputError("Le nom de la stratégie est requis");
  return trimmed.slice(0, 120);
}

export async function listStrategies(
  userId: string
): Promise<DefiStrategySummary[]> {
  return prisma.defiStrategy.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function createStrategy(
  userId: string,
  input: { name: string; notes?: string | null }
): Promise<DefiStrategySummary> {
  return prisma.defiStrategy.create({
    data: {
      userId,
      name: trimmedName(input.name),
      notes: input.notes?.trim() || null,
    },
    select: {
      id: true,
      name: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function renameStrategy(
  userId: string,
  id: string,
  input: { name: string; notes?: string | null }
): Promise<DefiStrategySummary> {
  const result = await prisma.defiStrategy.updateMany({
    where: owned(id, userId),
    data: {
      name: trimmedName(input.name),
      notes: input.notes?.trim() || null,
    },
  });
  if (!wroteOne(result)) throw new DefiInputError("Stratégie introuvable");

  return prisma.defiStrategy.findFirstOrThrow({
    where: { id },
    select: {
      id: true,
      name: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Supprime la stratégie. Les positions rattachées ne sont pas touchées : la
 * contrainte `SetNull` les détache, elles redeviennent des lignes autonomes.
 */
export async function deleteStrategy(
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const result = await prisma.defiStrategy.deleteMany({
    where: owned(id, userId),
  });
  return { deleted: wroteOne(result) };
}

/**
 * Rattache (ou détache si `strategyId` est `null`) une position à une
 * stratégie.
 *
 * `DefiPositionDetail` n'a pas de `userId` propre : l'appartenance passe par
 * l'actif, comme partout ailleurs dans ce module (cf. `defi-manual-service`).
 */
export async function setPositionStrategy(
  userId: string,
  positionId: string,
  strategyId: string | null
): Promise<void> {
  const position = await prisma.defiPositionDetail.findFirst({
    where: { id: positionId, asset: { is: { userId } } },
    select: { id: true },
  });
  if (!position) throw new DefiInputError("Position introuvable");

  if (strategyId) {
    const strategy = await prisma.defiStrategy.findFirst({
      where: owned(strategyId, userId),
      select: { id: true },
    });
    if (!strategy) throw new DefiInputError("Stratégie introuvable");
  }

  await prisma.defiPositionDetail.update({
    where: { id: positionId },
    data: { strategyId },
  });
}

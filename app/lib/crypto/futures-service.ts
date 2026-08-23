/**
 * CRUD des positions futures — seule couche de ce module qui touche Prisma.
 *
 * Contrairement au spot et à la DeFi, il n'y a pas de journal à tenir : une
 * position futures n'est pas un actif détenu, elle est stockée telle quelle.
 * Sa valorisation (marge, P&L latent, distance de liquidation) est recalculée
 * à la lecture par `app/lib/crypto/futures.ts`, jamais persistée.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import {
  CRYPTO_EXCHANGES,
  CRYPTO_MARGIN_TYPES,
  FUTURES_CONTRACT_TYPES,
} from "./futures-constants";

export class FuturesInputError extends Error {
  readonly code = "FUTURES_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "FuturesInputError";
  }
}

export type CreateFuturesInput = {
  exchange: string;
  subAccountLabel?: string | null;
  pair: string;
  contractType?: string;
  marginType: string;
  baseCurrency: string;
  quoteCurrency: string;
  direction: "LONG" | "SHORT";
  leverage: string;
  sizeContracts: string;
  entryPrice: string;
  markPrice?: string | null;
  marginUsed?: string | null;
  stopLoss?: string | null;
  takeProfit?: string | null;
  openedAt: string;
  notes?: string | null;
};

function dec(v: string | null | undefined) {
  if (v == null || v === "") return null;
  const n = d(v);
  return n.isFinite() ? n.toString() : null;
}

function validateCreate(input: CreateFuturesInput) {
  if (!input.pair.trim()) throw new FuturesInputError("La paire est requise");
  if (!(input.exchange in CRYPTO_EXCHANGES)) {
    throw new FuturesInputError("Exchange inconnu");
  }
  if (!(input.marginType in CRYPTO_MARGIN_TYPES)) {
    throw new FuturesInputError("Type de marge inconnu");
  }
  if (input.contractType && !(input.contractType in FUTURES_CONTRACT_TYPES)) {
    throw new FuturesInputError("Type de contrat inconnu");
  }
  if (input.direction !== "LONG" && input.direction !== "SHORT") {
    throw new FuturesInputError("Sens de position invalide");
  }
  const leverage = d(input.leverage);
  if (!leverage.isFinite() || leverage.lte(0)) {
    throw new FuturesInputError("Le levier doit être strictement positif");
  }
  const size = d(input.sizeContracts);
  if (!size.isFinite() || size.lte(0)) {
    throw new FuturesInputError("La taille doit être strictement positive");
  }
  const entry = d(input.entryPrice);
  if (!entry.isFinite() || entry.lte(0)) {
    throw new FuturesInputError("Le prix d'entrée doit être strictement positif");
  }
  const openedAt = new Date(input.openedAt);
  if (Number.isNaN(openedAt.getTime())) {
    throw new FuturesInputError("Date d'ouverture invalide");
  }
}

export async function createFuturesPosition(
  userId: string,
  input: CreateFuturesInput
) {
  validateCreate(input);
  const openedAt = new Date(input.openedAt);
  const size = d(input.sizeContracts);
  const entry = d(input.entryPrice);
  const notional = size.times(entry);

  return prisma.tradingPosition.create({
    data: {
      userId,
      exchange: input.exchange,
      subAccountLabel: input.subAccountLabel?.trim() || null,
      pair: input.pair.trim(),
      contractType: input.contractType || "PERPETUAL",
      marginType: input.marginType,
      baseCurrency: input.baseCurrency.trim().toUpperCase(),
      quoteCurrency: input.quoteCurrency.trim().toUpperCase(),
      direction: input.direction,
      leverage: input.leverage,
      sizeContracts: input.sizeContracts,
      notionalUsd: notional.toFixed(2),
      entryPrice: input.entryPrice,
      /*
        Repli sur le prix d'entrée quand rien n'est fourni : c'est ce que la
        position vaut à l'ouverture, mais ce n'est **pas** une observation de
        marché — d'où l'horodatage laissé nul dans ce cas.
      */
      markPrice: dec(input.markPrice) ?? input.entryPrice,
      markPriceUpdatedAt: dec(input.markPrice) != null ? new Date() : null,
      marginUsed: dec(input.marginUsed),
      stopLoss: dec(input.stopLoss),
      takeProfit: dec(input.takeProfit),
      isOpen: true,
      openedAt,
      notes: input.notes?.trim() || null,
    },
  });
}

export type UpdateFuturesInput = {
  markPrice?: string | null;
  stopLoss?: string | null;
  takeProfit?: string | null;
  fundingPaid?: string | null;
  commissionPaid?: string | null;
  notes?: string | null;
};

export async function updateFuturesPosition(
  userId: string,
  id: string,
  input: UpdateFuturesInput
) {
  const existing = await prisma.tradingPosition.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new FuturesInputError("Position introuvable");

  return prisma.tradingPosition.update({
    where: { id },
    data: {
      /*
        La date ne suit que le prix. `updatedAt` bouge pour n'importe quel
        champ : corriger une note ferait passer un prix vieux d'un mois pour
        une cotation fraîche.
      */
      ...(input.markPrice !== undefined && {
        markPrice: dec(input.markPrice),
        markPriceUpdatedAt: dec(input.markPrice) != null ? new Date() : null,
      }),
      ...(input.stopLoss !== undefined && { stopLoss: dec(input.stopLoss) }),
      ...(input.takeProfit !== undefined && { takeProfit: dec(input.takeProfit) }),
      ...(input.fundingPaid !== undefined && { fundingPaid: dec(input.fundingPaid) }),
      ...(input.commissionPaid !== undefined && {
        commissionPaid: dec(input.commissionPaid),
      }),
      ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
    },
  });
}

/**
 * Clôture une position : fige le P&L réalisé à partir du dernier mark price,
 * ou d'un prix de sortie fourni explicitement.
 */
export async function closeFuturesPosition(
  userId: string,
  id: string,
  exitPrice?: string | null
) {
  const existing = await prisma.tradingPosition.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new FuturesInputError("Position introuvable");
  if (!existing.isOpen) throw new FuturesInputError("Position déjà clôturée");

  const exit = exitPrice ? d(exitPrice) : d(existing.markPrice?.toString() ?? existing.entryPrice.toString());
  const size = d(existing.sizeContracts.toString());
  const entry = d(existing.entryPrice.toString());
  const realized =
    existing.direction === "LONG"
      ? size.times(exit.minus(entry))
      : size.times(entry.minus(exit));

  return prisma.tradingPosition.update({
    where: { id },
    data: {
      isOpen: false,
      closedAt: new Date(),
      markPrice: exit.toFixed(8),
      // Le prix de sortie est une observation, et la dernière : une position
      // close ne bougera plus.
      markPriceUpdatedAt: new Date(),
      realizedPnl: realized.toFixed(2),
    },
  });
}

export async function deleteFuturesPosition(userId: string, id: string) {
  const existing = await prisma.tradingPosition.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new FuturesInputError("Position introuvable");
  await prisma.tradingPosition.delete({ where: { id } });
}

export async function listFuturesPositions(userId: string, opts?: { isOpen?: boolean }) {
  return prisma.tradingPosition.findMany({
    where: {
      userId,
      ...(opts?.isOpen !== undefined ? { isOpen: opts.isOpen } : {}),
    },
    orderBy: [{ isOpen: "desc" }, { openedAt: "desc" }],
  });
}

/**
 * CRUD des comptes de trading — seule couche du module à toucher Prisma.
 *
 * Un `TradingAccount` ne porte aucun P&L : ce que les positions ont rapporté
 * se recalcule depuis elles, comme partout ailleurs dans le dépôt. Seul le
 * solde et la marge disponible sont déclaratifs, parce qu'ils viennent du
 * relevé du courtier et qu'aucun calcul ne peut les reconstituer.
 */

import { prisma } from "../prisma";
import { owned, wroteOne } from "../db/tenant-scope";

export const TRADING_ACCOUNT_TYPES = {
  CFD: "CFD",
  FUTURES: "Futures",
  SPREAD_BETTING: "Spread betting",
  MIXED: "Mixte",
} as const;

export type TradingAccountType = keyof typeof TRADING_ACCOUNT_TYPES;

export function tradingAccountTypeLabel(value: string): string {
  return TRADING_ACCOUNT_TYPES[value as TradingAccountType] ?? value;
}

export function isTradingAccountType(
  value: string
): value is TradingAccountType {
  return value in TRADING_ACCOUNT_TYPES;
}

export class TradingInputError extends Error {
  readonly code = "TRADING_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "TradingInputError";
  }
}

export type TradingAccountSummary = {
  id: string;
  brokerName: string;
  accountType: TradingAccountType;
  accountTypeLabel: string;
  currency: string;
  balance: string;
  marginAvailable: string | null;
  openDate: Date | null;
  notes: string | null;
  /** Positions rattachées — jamais leur résultat, qui se recalcule. */
  positionCount: number;
  openPositionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTradingAccountInput = {
  brokerName: string;
  accountType: string;
  currency?: string | null;
  balance?: string | null;
  marginAvailable?: string | null;
  openDate?: string | null;
  notes?: string | null;
};

function decimalOrNull(v: string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) {
    throw new TradingInputError("Montant invalide");
  }
  return String(n);
}

function parseOpenDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new TradingInputError("Date d'ouverture invalide");
  }
  if (date.getTime() > Date.now()) {
    throw new TradingInputError(
      "La date d'ouverture ne peut pas être dans le futur"
    );
  }
  return date;
}

type AccountRow = {
  id: string;
  brokerName: string;
  accountType: string;
  currency: string;
  balance: { toString(): string };
  marginAvailable: { toString(): string } | null;
  openDate: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  positions: { isOpen: boolean }[];
};

function toSummary(row: AccountRow): TradingAccountSummary {
  return {
    id: row.id,
    brokerName: row.brokerName,
    accountType: row.accountType as TradingAccountType,
    accountTypeLabel: tradingAccountTypeLabel(row.accountType),
    currency: row.currency,
    balance: row.balance.toString(),
    marginAvailable: row.marginAvailable?.toString() ?? null,
    openDate: row.openDate,
    notes: row.notes,
    positionCount: row.positions.length,
    openPositionCount: row.positions.filter((p) => p.isOpen).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const accountSelect = {
  id: true,
  brokerName: true,
  accountType: true,
  currency: true,
  balance: true,
  marginAvailable: true,
  openDate: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  positions: { select: { isOpen: true } },
} as const;

export async function listTradingAccounts(
  userId: string
): Promise<TradingAccountSummary[]> {
  const rows = await prisma.tradingAccount.findMany({
    where: { userId },
    orderBy: [{ brokerName: "asc" }],
    select: accountSelect,
  });
  return rows.map(toSummary);
}

export async function createTradingAccount(
  userId: string,
  input: CreateTradingAccountInput
): Promise<TradingAccountSummary> {
  const brokerName = input.brokerName.trim();
  if (!brokerName) throw new TradingInputError("Le courtier est requis");

  if (!isTradingAccountType(input.accountType)) {
    throw new TradingInputError("Type de compte inconnu");
  }

  const row = await prisma.tradingAccount.create({
    data: {
      userId,
      brokerName: brokerName.slice(0, 120),
      accountType: input.accountType,
      currency: (input.currency || "EUR").trim().toUpperCase().slice(0, 8),
      balance: decimalOrNull(input.balance) ?? "0",
      marginAvailable: decimalOrNull(input.marginAvailable),
      openDate: parseOpenDate(input.openDate),
      notes: input.notes?.trim() || null,
    },
    select: accountSelect,
  });
  return toSummary(row);
}

export async function updateTradingAccount(
  userId: string,
  id: string,
  input: Partial<CreateTradingAccountInput>
): Promise<TradingAccountSummary> {
  const data: Record<string, unknown> = {};
  if (input.brokerName !== undefined) {
    const name = input.brokerName.trim();
    if (!name) throw new TradingInputError("Le courtier est requis");
    data.brokerName = name.slice(0, 120);
  }
  if (input.accountType !== undefined) {
    if (!isTradingAccountType(input.accountType)) {
      throw new TradingInputError("Type de compte inconnu");
    }
    data.accountType = input.accountType;
  }
  if (input.currency !== undefined) {
    data.currency = (input.currency || "EUR").trim().toUpperCase().slice(0, 8);
  }
  if (input.balance !== undefined) {
    data.balance = decimalOrNull(input.balance) ?? "0";
  }
  if (input.marginAvailable !== undefined) {
    data.marginAvailable = decimalOrNull(input.marginAvailable);
  }
  if (input.openDate !== undefined) data.openDate = parseOpenDate(input.openDate);
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

  const result = await prisma.tradingAccount.updateMany({
    where: owned(id, userId),
    data,
  });
  if (!wroteOne(result)) throw new TradingInputError("Compte introuvable");

  const row = await prisma.tradingAccount.findFirstOrThrow({
    where: { id },
    select: accountSelect,
  });
  return toSummary(row);
}

/**
 * Supprime un compte. Les positions ne sont jamais supprimées : `SetNull` les
 * détache, et le journal de trading — donc le P&L réalisé et l'historique
 * fiscal — reste lisible.
 */
export async function deleteTradingAccount(
  userId: string,
  id: string
): Promise<{ deleted: boolean; detachedPositions: number }> {
  const account = await prisma.tradingAccount.findFirst({
    where: owned(id, userId),
    select: { _count: { select: { positions: true } } },
  });
  if (!account) return { deleted: false, detachedPositions: 0 };

  const result = await prisma.tradingAccount.deleteMany({
    where: owned(id, userId),
  });
  return {
    deleted: wroteOne(result),
    detachedPositions: account._count.positions,
  };
}

/** Rattache (ou détache) une position à un compte de trading. */
export async function setPositionAccount(
  userId: string,
  positionId: string,
  tradingAccountId: string | null
): Promise<void> {
  const position = await prisma.tradingPosition.findFirst({
    where: { id: positionId, userId },
    select: { id: true },
  });
  if (!position) throw new TradingInputError("Position introuvable");

  if (tradingAccountId) {
    const account = await prisma.tradingAccount.findFirst({
      where: owned(tradingAccountId, userId),
      select: { id: true },
    });
    if (!account) throw new TradingInputError("Compte introuvable");
  }

  await prisma.tradingPosition.update({
    where: { id: positionId },
    data: { tradingAccountId },
  });
}

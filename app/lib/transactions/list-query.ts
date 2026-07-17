/**
 * Contrat GET /api/transactions — pagination + filtres serveur.
 *
 * Query params :
 * - page (1-based, défaut 1)
 * - pageSize (défaut 50, max 100)
 * - typeGroup : all|buy|sell|dividend|fees|cash|transfer|split
 * - type : type Prisma exact (ACHAT, …) — prioritaire sur typeGroup si fourni
 * - accountType : CTO|PEA|…
 * - q : recherche libre (nom, ticker, ISIN, plateforme, notes)
 *
 * Réponse :
 * { transactions, total, totalAll, page, pageSize, pageCount, typeCounts }
 */

import type { Prisma } from "@prisma/client";

export const TX_LIST_DEFAULT_PAGE_SIZE = 50;
export const TX_LIST_MAX_PAGE_SIZE = 100;

/** Aligné sur `TX_TYPE_FILTERS` UI (ids stables). */
export const TX_TYPE_GROUPS: Record<string, string[] | null> = {
  all: null,
  buy: ["ACHAT"],
  sell: ["VENTE"],
  dividend: ["DIVIDENDE", "COUPON", "LOYER", "INTERET"],
  fees: ["FRAIS"],
  cash: ["APPORT", "RETRAIT"],
  transfer: ["TRANSFERT_CASH", "TRANSFERT_TITRE"],
  split: ["SPLIT"],
};

export type TxListQuery = {
  page: number;
  pageSize: number;
  typeGroup: string;
  typeExact: string | null;
  accountType: string | null;
  q: string | null;
};

export function parseTxListQuery(
  searchParams: URLSearchParams
): TxListQuery {
  const pageRaw = Number(searchParams.get("page") || "1");
  const page = Number.isFinite(pageRaw)
    ? Math.max(1, Math.floor(pageRaw))
    : 1;

  const sizeRaw = Number(
    searchParams.get("pageSize") || String(TX_LIST_DEFAULT_PAGE_SIZE)
  );
  let pageSize = Number.isFinite(sizeRaw)
    ? Math.floor(sizeRaw)
    : TX_LIST_DEFAULT_PAGE_SIZE;
  pageSize = Math.min(
    TX_LIST_MAX_PAGE_SIZE,
    Math.max(1, pageSize || TX_LIST_DEFAULT_PAGE_SIZE)
  );

  const typeExact = searchParams.get("type")?.trim().toUpperCase() || null;
  const typeGroup = (
    searchParams.get("typeGroup") ||
    searchParams.get("filter") ||
    "all"
  )
    .trim()
    .toLowerCase();

  const accountType =
    searchParams.get("accountType")?.trim().toUpperCase() || null;
  const qRaw = searchParams.get("q")?.trim() || "";
  const q = qRaw.length > 0 ? qRaw.slice(0, 120) : null;

  return {
    page,
    pageSize,
    typeGroup: typeGroup in TX_TYPE_GROUPS ? typeGroup : "all",
    typeExact: typeExact && typeExact.length > 0 ? typeExact : null,
    accountType: accountType && accountType.length > 0 ? accountType : null,
    q,
  };
}

export function resolveTypeFilter(
  query: TxListQuery
): string[] | null {
  if (query.typeExact) return [query.typeExact];
  const group = TX_TYPE_GROUPS[query.typeGroup];
  return group === undefined ? null : group;
}

/**
 * Where Prisma pour la liste filtrée (sans pagination).
 */
export function buildTxListWhere(
  userId: string,
  query: TxListQuery,
  opts?: { omitTypeFilter?: boolean }
): Prisma.TransactionWhereInput {
  const types = opts?.omitTypeFilter ? null : resolveTypeFilter(query);

  const where: Prisma.TransactionWhereInput = {
    userId,
  };

  if (types && types.length > 0) {
    where.type = types.length === 1 ? types[0] : { in: types };
  }

  if (query.accountType) {
    where.asset = { accountType: query.accountType };
  }

  if (query.q) {
    const q = query.q;
    where.OR = [
      { notes: { contains: q, mode: "insensitive" } },
      { type: { contains: q, mode: "insensitive" } },
      { currency: { contains: q, mode: "insensitive" } },
      { asset: { name: { contains: q, mode: "insensitive" } } },
      { asset: { ticker: { contains: q, mode: "insensitive" } } },
      { asset: { isin: { contains: q, mode: "insensitive" } } },
      { platform: { name: { contains: q, mode: "insensitive" } } },
      { toPlatform: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

export function mapTypeCountsToGroups(
  rows: Array<{ type: string; _count: { _all: number } | number }>
): Record<string, number> {
  const byType = new Map<string, number>();
  let all = 0;
  for (const r of rows) {
    const c =
      typeof r._count === "number" ? r._count : r._count._all;
    byType.set(r.type, c);
    all += c;
  }

  const out: Record<string, number> = { all };
  for (const [id, types] of Object.entries(TX_TYPE_GROUPS)) {
    if (id === "all" || !types) continue;
    out[id] = types.reduce((s, t) => s + (byType.get(t) || 0), 0);
  }
  return out;
}

export const TX_LIST_SELECT = {
  id: true,
  type: true,
  occurredAt: true,
  quantity: true,
  unitPrice: true,
  fees: true,
  currency: true,
  fxRateToEur: true,
  grossAmountEur: true,
  netCashImpactEur: true,
  notes: true,
  platformId: true,
  toPlatformId: true,
  assetId: true,
  asset: {
    select: {
      name: true,
      ticker: true,
      isin: true,
      accountType: true,
    },
  },
  platform: {
    select: {
      name: true,
      logoUrl: true,
    },
  },
  toPlatform: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.TransactionSelect;

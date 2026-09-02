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

import type { Prisma } from "@/app/lib/prisma-client/client";
import { nftExcludePrismaClause } from "./nft-filter";

export const TX_LIST_DEFAULT_PAGE_SIZE = 50;
export const TX_LIST_MAX_PAGE_SIZE = 100;

/** Aligné sur `TX_TYPE_FILTERS` UI (ids stables). */
export const TX_TYPE_GROUPS: Record<string, string[] | null> = {
  all: null,
  buy: ["ACHAT"],
  sell: ["VENTE"],
  // Distincts (voir TX_TYPE_FILTERS) : un airdrop ne doit compter que dans
  // un seul badge.
  reward: ["REWARD"],
  airdrop: ["AIRDROP"],
  dividend: ["DIVIDENDE", "COUPON", "LOYER", "INTERET"],
  fees: ["FRAIS"],
  cash: ["APPORT", "RETRAIT"],
  transfer: ["TRANSFERT_CASH", "TRANSFERT_TITRE"],
  split: ["SPLIT"],
  works: ["TRAVAUX"],
};

export type TxListSortBy =
  | "date"
  | "type"
  | "asset"
  | "envelope"
  | "platform"
  | "quantity"
  | "currency"
  | "netPrice";

export type TxListQuery = {
  page: number;
  pageSize: number;
  typeGroup: string;
  typeExact: string | null;
  accountType: string | null;
  q: string | null;
  sortBy: TxListSortBy;
  sortDir: "asc" | "desc";
  /** Bornes ISO "YYYY-MM-DD" (inclusives), ou null si absentes/invalides. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Plateforme (source OU destination d'un transfert) */
  platformId: string | null;
};

/** "YYYY-MM-DD" strict — un `input[type=date]` renvoie toujours ce format. */
function parseIsoDateParam(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const SORT_BY_SET = new Set<TxListSortBy>([
  "date",
  "type",
  "asset",
  "envelope",
  "platform",
  "quantity",
  "currency",
  "netPrice",
]);

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

  const sortRaw = (searchParams.get("sortBy") || "date").trim();
  const sortBy = SORT_BY_SET.has(sortRaw as TxListSortBy)
    ? (sortRaw as TxListSortBy)
    : "date";
  const dirRaw = (searchParams.get("sortDir") || "desc").trim().toLowerCase();
  const sortDir: "asc" | "desc" = dirRaw === "asc" ? "asc" : "desc";

  const dateFrom = parseIsoDateParam(searchParams.get("dateFrom"));
  const dateTo = parseIsoDateParam(searchParams.get("dateTo"));
  const platformId = searchParams.get("platformId")?.trim() || null;

  return {
    page,
    pageSize,
    typeGroup: typeGroup in TX_TYPE_GROUPS ? typeGroup : "all",
    typeExact: typeExact && typeExact.length > 0 ? typeExact : null,
    accountType: accountType && accountType.length > 0 ? accountType : null,
    q,
    sortBy,
    sortDir,
    dateFrom,
    dateTo,
    platformId,
  };
}

/** OrderBy Prisma pour la liste transactions. */
export function buildTxListOrderBy(
  query: TxListQuery
): Prisma.TransactionOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case "type":
      return [{ type: dir }, { occurredAt: "desc" }, { id: "asc" }];
    case "asset":
      return [
        { asset: { name: dir } },
        { occurredAt: "desc" },
        { id: "asc" },
      ];
    case "envelope":
      return [
        { asset: { accountType: dir } },
        { occurredAt: "desc" },
        { id: "asc" },
      ];
    case "platform":
      return [
        { platform: { name: dir } },
        { occurredAt: "desc" },
        { id: "asc" },
      ];
    case "currency":
      return [{ currency: dir }, { occurredAt: "desc" }, { id: "asc" }];
    case "quantity":
      return [{ quantity: dir }, { occurredAt: "desc" }, { id: "asc" }];
    case "netPrice":
      return [
        { netCashImpactEur: dir },
        { occurredAt: "desc" },
        { id: "asc" },
      ];
    case "date":
    default:
      return [{ occurredAt: dir }, { id: "asc" }];
  }
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

  const nftExclude = nftExcludePrismaClause();
  const where: Prisma.TransactionWhereInput = {
    userId,
    // Vue principale : pas de NFT (toutes blockchains)
    AND: nftExclude.AND as Prisma.TransactionWhereInput[],
  };

  if (types && types.length > 0) {
    where.type = types.length === 1 ? types[0] : { in: types };
  }

  if (query.accountType) {
    where.asset = { accountType: query.accountType };
  }

  if (query.dateFrom || query.dateTo) {
    const occurredAt: Prisma.DateTimeFilter = {};
    if (query.dateFrom) occurredAt.gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
    if (query.dateTo) occurredAt.lte = new Date(`${query.dateTo}T23:59:59.999Z`);
    where.occurredAt = occurredAt;
  }

  if (query.platformId) {
    // Source OU destination d'un transfert — `where.OR` déjà réservé à la
    // recherche texte, donc combiné via AND plutôt que d'écraser ce dernier.
    (where.AND as Prisma.TransactionWhereInput[]).push({
      OR: [
        { platformId: query.platformId },
        { toPlatformId: query.platformId },
      ],
    });
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

export type TxKpis = {
  /** Σ grossAmountEur des ACHAT (valeur brute investie, hors frais) */
  buysEur: number;
  /** Σ grossAmountEur des VENTE (produit brut de cession, hors frais) */
  sellsEur: number;
  /** Σ feesEur, tous types confondus */
  feesEur: number;
  /** Σ netCashImpactEur des revenus cash (dividende, coupon, loyer, intérêt)
   *  + Σ grossAmountEur (FMV) des REWARD (staking…), qui n'ont pas d'impact
   *  cash mais restent un revenu au sens patrimonial. */
  incomeEur: number;
};

type TxGroupSums = {
  type: string;
  _sum: {
    grossAmountEur: { toString(): string } | number | null;
    feesEur: { toString(): string } | number | null;
    netCashImpactEur: { toString(): string } | number | null;
  };
};

function sumOf(v: TxGroupSums["_sum"][keyof TxGroupSums["_sum"]]): number {
  if (v == null) return 0;
  const n = Number(typeof v === "number" ? v : v.toString());
  return Number.isFinite(n) ? n : 0;
}

/**
 * KPI agrégés (Σ) sur le périmètre filtré — même `where` que typeCounts
 * (hors filtre de type, pour que les 4 totaux restent lisibles ensemble
 * quel que soit le quick-filter actif).
 *
 * ACHAT/VENTE : `netCashImpactEur` est stocké à 0 pour les trades (le cash
 * est suivi par ailleurs, voir `computeNetCashImpactEur`) — on utilise donc
 * `grossAmountEur`, comme `txNetPriceEur` côté affichage ligne par ligne.
 *
 * REWARD : même chose — `netCashImpactEur` vaut toujours 0 (réception
 * gratuite, aucun mouvement de cash), donc on utilise `grossAmountEur`
 * (FMV qty × prix unitaire si renseigné, sinon 0) pour le compter dans les
 * revenus. AIRDROP reste hors "Revenus" (voir TX_TYPE_GROUPS : distinct de
 * reward, traité comme une entrée patrimoniale gratuite plutôt qu'un revenu).
 */
export function computeTxKpis(rows: TxGroupSums[]): TxKpis {
  let buysEur = 0;
  let sellsEur = 0;
  let feesEur = 0;
  let incomeEur = 0;

  for (const r of rows) {
    feesEur += sumOf(r._sum.feesEur);
    if (r.type === "ACHAT") buysEur += sumOf(r._sum.grossAmountEur);
    else if (r.type === "VENTE") sellsEur += sumOf(r._sum.grossAmountEur);
    else if (["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(r.type)) {
      incomeEur += sumOf(r._sum.netCashImpactEur);
    } else if (r.type === "REWARD") {
      incomeEur += sumOf(r._sum.grossAmountEur);
    }
  }

  return { buysEur, sellsEur, feesEur, incomeEur };
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
      assetClass: true,
      logoUrl: true,
      notes: true,
      providerSymbol: true,
    },
  },
  platform: {
    select: {
      name: true,
      logoUrl: true,
      logoKey: true,
      type: true,
      subtype: true,
    },
  },
  toPlatform: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.TransactionSelect;

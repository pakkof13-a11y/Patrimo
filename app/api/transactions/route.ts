import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { createTransactionSchema } from "@/app/lib/schemas";
import {
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "@/app/lib/transactions/service";
import { AccountingError } from "@/app/lib/accounting";
import {
  buildTxListOrderBy,
  buildTxListWhere,
  mapTypeCountsToGroups,
  parseTxListQuery,
  TX_LIST_SELECT,
} from "@/app/lib/transactions/list-query";
import {
  blockchainLabel,
  resolveBlockchainKey,
} from "@/app/lib/assets/blockchain";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function mapTx(t: {
  id: string;
  type: string;
  occurredAt: Date;
  quantity: { toString(): string } | null;
  unitPrice: { toString(): string } | null;
  fees: { toString(): string };
  currency: string;
  fxRateToEur: { toString(): string };
  grossAmountEur: { toString(): string };
  netCashImpactEur: { toString(): string };
  notes: string | null;
  platformId: string;
  toPlatformId: string | null;
  assetId: string | null;
  asset: {
    name: string;
    ticker: string | null;
    isin: string | null;
    accountType: string;
    assetClass?: string | null;
    logoUrl: string | null;
    notes?: string | null;
    providerSymbol?: string | null;
  } | null;
  platform: {
    name: string;
    logoUrl: string | null;
    logoKey?: string | null;
    type?: string | null;
    subtype?: string | null;
  };
  toPlatform: { name: string } | null;
}) {
  const chainKey = resolveBlockchainKey({
    platformType: t.platform.type,
    platformLogoKey: t.platform.logoKey,
    platformName: t.platform.name,
    platformSubtype: t.platform.subtype,
    assetNotes: t.asset?.notes,
    providerSymbol: t.asset?.providerSymbol,
    accountType: t.asset?.accountType,
    assetClass: t.asset?.assetClass,
  });
  return {
    id: t.id,
    type: t.type,
    occurredAt: t.occurredAt.toISOString(),
    quantity: t.quantity?.toString() ?? null,
    unitPrice: t.unitPrice?.toString() ?? null,
    fees: t.fees.toString(),
    currency: t.currency,
    fxRateToEur: t.fxRateToEur.toString(),
    grossAmountEur: t.grossAmountEur.toString(),
    netCashImpactEur: t.netCashImpactEur.toString(),
    notes: t.notes,
    platformId: t.platformId,
    toPlatformId: t.toPlatformId,
    assetId: t.assetId,
    asset: t.asset
      ? {
          name: t.asset.name,
          ticker: t.asset.ticker,
          isin: t.asset.isin,
          accountType: t.asset.accountType,
          assetClass: t.asset.assetClass ?? null,
          logoUrl: t.asset.logoUrl,
          notes: t.asset.notes ?? null,
          providerSymbol: t.asset.providerSymbol ?? null,
        }
      : null,
    platform: {
      name: t.platform.name,
      logoUrl: t.platform.logoUrl,
      logoKey: t.platform.logoKey ?? null,
      type: t.platform.type ?? null,
      subtype: t.platform.subtype ?? null,
    },
    toPlatform: t.toPlatform ? { name: t.toPlatform.name } : null,
    blockchainKey: chainKey,
    blockchainLabel: blockchainLabel(chainKey),
  };
}

/**
 * GET /api/transactions
 * Pagination serveur + filtres (typeGroup, accountType, q).
 * Voir `app/lib/transactions/list-query.ts` et `docs/api-transactions.md`.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = parseTxListQuery(url.searchParams);
  const where = buildTxListWhere(userId, query);
  const whereForCounts = buildTxListWhere(userId, query, {
    omitTypeFilter: true,
  });

  const skip = (query.page - 1) * query.pageSize;

  const [rows, total, totalAll, grouped] = await Promise.all([
    prisma.transaction.findMany({
      where,
      select: TX_LIST_SELECT,
      orderBy: buildTxListOrderBy(query),
      skip,
      take: query.pageSize,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.count({ where: { userId } }),
    prisma.transaction.groupBy({
      by: ["type"],
      where: whereForCounts,
      _count: { _all: true },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / query.pageSize) || 1);
  // Clamp page if client asked beyond last page
  const safePage = Math.min(query.page, pageCount);

  const typeCounts = mapTypeCountsToGroups(
    grouped.map((g) => ({
      type: g.type,
      _count: g._count._all,
    }))
  );

  return NextResponse.json(
    {
      transactions: rows.map(mapTx),
      total,
      totalAll,
      page: safePage,
      pageSize: query.pageSize,
      pageCount,
      typeCounts,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const bodyObj = (body ?? {}) as Record<string, unknown>;
    const created = await createTransaction({
      ...parsed.data,
      userId,
      autoFundCash:
        bodyObj.autoFundCash === undefined
          ? true
          : Boolean(bodyObj.autoFundCash),
      allowNegativeCash: Boolean(bodyObj.allowNegativeCash),
    });
    return NextResponse.json({ transaction: created }, { status: 201 });
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: 400 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // fix(OPT-02): wrap req.json() in try/catch — malformed JSON now returns 400 instead of 500
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const bodyObj = (body ?? {}) as Record<string, unknown>;
    const updated = await updateTransaction({
      ...parsed.data,
      userId,
      id,
      autoFundCash: Boolean(bodyObj.autoFundCash),
      allowNegativeCash: Boolean(bodyObj.allowNegativeCash),
    });
    return NextResponse.json({ transaction: updated });
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: 400 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  try {
    await deleteTransaction(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: 400 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { createTransactionSchema } from "@/app/lib/schemas";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "@/app/lib/transactions/service";
import { AccountingError } from "@/app/lib/accounting";

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
  } | null;
  platform: { name: string; logoUrl: string | null };
  toPlatform: { name: string } | null;
}) {
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
        }
      : null,
    platform: { name: t.platform.name, logoUrl: t.platform.logoUrl },
    toPlatform: t.toPlatform ? { name: t.toPlatform.name } : null,
  };
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      include: { asset: true, platform: true, toPlatform: true },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 5000,
    }),
    prisma.transaction.count({ where: { userId } }),
  ]);

  const transactions = rows.map(mapTx);

  return NextResponse.json(
    { transactions, total },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const bodyObj = body as Record<string, unknown>;
    const created = await createTransaction({
      ...parsed.data,
      userId,
      autoFundCash:
        bodyObj.autoFundCash === undefined ? true : Boolean(bodyObj.autoFundCash),
      allowNegativeCash: Boolean(bodyObj.allowNegativeCash),
    });
    return NextResponse.json({ transaction: created }, { status: 201 });
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const bodyObj = body as Record<string, unknown>;
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
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  try {
    await deleteTransaction(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

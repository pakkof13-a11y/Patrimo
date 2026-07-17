import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { getAssetDetail } from "@/app/lib/portfolio/service";
import { updateAssetMetadataSchema } from "@/app/lib/schemas";
import { presentFields, validationErrorResponse } from "@/app/lib/api/validation";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const detail = await getAssetDetail(userId, id);
  if (!detail) return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });

  return NextResponse.json(detail);
}

/**
 * PATCH asset metadata (ticker, providerSymbol, name…).
 * Used e.g. to correct the ticker after autocomplete filled a wrong default.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const asset = await prisma.asset.findFirst({ where: { id, userId } });
  if (!asset) return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = updateAssetMetadataSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: {
    ticker?: string | null;
    providerSymbol?: string | null;
    name?: string;
    countryCode?: string | null;
    withholdingTaxRate?: Prisma.Decimal | null;
  } = {};

  if (f.ticker !== undefined) {
    data.ticker = f.ticker;
    // Keep quote provider symbol aligned when it was empty or equalled the old ticker
    if (f.ticker != null) {
      const oldTicker = (asset.ticker || "").toUpperCase();
      const oldSym = (asset.providerSymbol || "").toUpperCase();
      if (!oldSym || oldSym === oldTicker) {
        data.providerSymbol = f.ticker;
      }
    }
  }

  if (f.name !== undefined) data.name = f.name;

  if (f.countryCode !== undefined) data.countryCode = f.countryCode;

  if (f.withholdingTaxRate !== undefined) {
    data.withholdingTaxRate =
      f.withholdingTaxRate == null
        ? null
        : new Prisma.Decimal(String(f.withholdingTaxRate));
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const write = await prisma.asset.updateMany({ where: { id, userId }, data });
  if (write.count === 0) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }
  const updated = await prisma.asset.findFirst({ where: { id, userId } });
  if (!updated) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }
  return NextResponse.json({
    asset: {
      id: updated.id,
      name: updated.name,
      ticker: updated.ticker,
      providerSymbol: updated.providerSymbol,
      countryCode: updated.countryCode ?? null,
      withholdingTaxRate: updated.withholdingTaxRate?.toString() ?? null,
    },
  });
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { getAssetDetail } from "@/app/lib/portfolio/service";

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const data: {
    ticker?: string | null;
    providerSymbol?: string | null;
    name?: string;
    countryCode?: string | null;
    withholdingTaxRate?: import("@prisma/client").Prisma.Decimal | null;
  } = {};

  if ("ticker" in body) {
    const raw = body.ticker;
    if (raw == null || raw === "") {
      data.ticker = null;
    } else {
      const t = String(raw).trim().toUpperCase();
      if (t.length > 32) {
        return NextResponse.json({ error: "Ticker trop long" }, { status: 400 });
      }
      data.ticker = t || null;
      // Keep quote provider symbol aligned when it was empty or equalled the old ticker
      const oldTicker = (asset.ticker || "").toUpperCase();
      const oldSym = (asset.providerSymbol || "").toUpperCase();
      if (!oldSym || oldSym === oldTicker) {
        data.providerSymbol = data.ticker;
      }
    }
  }

  if ("name" in body && body.name != null && String(body.name).trim()) {
    data.name = String(body.name).trim();
  }

  if ("countryCode" in body) {
    const raw = body.countryCode;
    if (raw == null || raw === "") {
      data.countryCode = null;
    } else {
      data.countryCode = String(raw).trim().toUpperCase().slice(0, 2) || null;
    }
  }

  if ("withholdingTaxRate" in body) {
    const raw = body.withholdingTaxRate;
    if (raw == null || raw === "") {
      data.withholdingTaxRate = null;
    } else {
      let r = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(r)) {
        return NextResponse.json({ error: "Taux WHT invalide" }, { status: 400 });
      }
      if (r > 1 && r <= 100) r = r / 100;
      r = Math.min(1, Math.max(0, r));
      const { Prisma } = await import("@prisma/client");
      data.withholdingTaxRate = new Prisma.Decimal(String(r));
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const updated = await prisma.asset.update({ where: { id }, data });
  return NextResponse.json({
    asset: {
      id: updated.id,
      name: updated.name,
      ticker: updated.ticker,
      providerSymbol: updated.providerSymbol,
      countryCode: (updated as { countryCode?: string | null }).countryCode ?? null,
      withholdingTaxRate:
        (updated as { withholdingTaxRate?: { toString(): string } | null })
          .withholdingTaxRate?.toString() ?? null,
    },
  });
}

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { addAssetSchema } from "@/app/lib/schemas";
import { toEurAmount } from "@/app/lib/market/fx";
import { resolveAssetLogo } from "@/app/lib/assets/logos";
import { assetReuseByTickerWhere } from "@/app/lib/assets/reuse";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  const assets = await prisma.asset.findMany({
    where: { userId },
    include: { platform: true, priceQuote: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ assets });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  const body = await req.json();
  const parsed = addAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const platform = await prisma.platform.findFirst({
    where: { id: parsed.data.platformId, userId },
  });
  if (!platform) return NextResponse.json({ error: "Plateforme introuvable" }, { status: 404 });

  // Reuse by ticker + tax envelope. Positions stay per (assetId, platformId) on txs —
  // never overwrite Asset.platformId (home display) when trading on another broker.
  if (parsed.data.ticker) {
    const accountType = parsed.data.accountType || "CTO";
    const existingByTicker = await prisma.asset.findFirst({
      where: assetReuseByTickerWhere(userId, parsed.data.ticker, accountType),
      orderBy: { createdAt: "asc" },
    });
    if (existingByTicker) {
      return NextResponse.json({ asset: existingByTicker, existing: true });
    }
  }

  // Fallback: same name on same platform
  const existingByName = await prisma.asset.findFirst({
    where: {
      userId,
      platformId: parsed.data.platformId,
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
  });
  if (existingByName) {
    return NextResponse.json({ asset: existingByName, existing: true });
  }

  const currency = (parsed.data.currency || "EUR").toUpperCase();
  const defaultProvider =
    parsed.data.assetClass === "CRYPTO"
      ? "COINGECKO"
      : parsed.data.assetClass === "ACTIONS"
        ? "YAHOO"
        : "MANUAL";

  const logoUrl =
    (body as { logoUrl?: string }).logoUrl ||
    resolveAssetLogo({
      ticker: parsed.data.ticker,
      name: parsed.data.name,
      assetClass: parsed.data.assetClass,
    });

  const whtRaw = parsed.data.withholdingTaxRate;
  let whtRate: Prisma.Decimal | null = null;
  if (whtRaw != null && String(whtRaw).trim() !== "") {
    let r = Number(String(whtRaw).replace(",", "."));
    if (Number.isFinite(r)) {
      if (r > 1 && r <= 100) r = r / 100;
      whtRate = new Prisma.Decimal(String(Math.min(1, Math.max(0, r))));
    }
  }

  const asset = await prisma.asset.create({
    data: {
      userId,
      platformId: parsed.data.platformId,
      name: parsed.data.name,
      ticker: parsed.data.ticker || null,
      assetClass: parsed.data.assetClass,
      currency,
      countryCode: parsed.data.countryCode || null,
      withholdingTaxRate: whtRate,
      accountType: parsed.data.accountType || "CTO",
      priceProvider: parsed.data.priceProvider || defaultProvider,
      providerSymbol: parsed.data.providerSymbol || parsed.data.ticker || null,
      logoUrl: logoUrl || null,
      manualPrice: parsed.data.manualPrice ? new Prisma.Decimal(parsed.data.manualPrice) : null,
      acquisitionDate: parsed.data.acquisitionDate
        ? new Date(parsed.data.acquisitionDate)
        : null,
      notes: parsed.data.notes || null,
    },
  });

  if (parsed.data.manualPrice) {
    const priceEur = await toEurAmount(parsed.data.manualPrice, currency);
    await prisma.priceQuote.create({
      data: {
        assetId: asset.id,
        priceNative: new Prisma.Decimal(parsed.data.manualPrice),
        nativeCurrency: currency,
        priceEur: new Prisma.Decimal(priceEur),
        source: "manual",
        status: "OK",
        lastUpdatedAt: new Date(),
      },
    });
  }

  return NextResponse.json({ asset, existing: false }, { status: 201 });
}

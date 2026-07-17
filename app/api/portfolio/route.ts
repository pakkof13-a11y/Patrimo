import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  getPortfolioBundle,
  getPortfolioHistory,
  recordPortfolioSnapshot,
} from "@/app/lib/portfolio/service";
import { prisma } from "@/app/lib/prisma";
import { portfolioBaseCurrencySchema } from "@/app/lib/schemas";
import { validationErrorResponse } from "@/app/lib/api/validation";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const base = searchParams.get("base") || user?.baseCurrency || "EUR";

    // First visit: seed today's snapshot so the curve has a starting point
    const snapshotCount = await prisma.portfolioSnapshot.count({ where: { userId } });
    if (snapshotCount === 0) {
      try {
        await recordPortfolioSnapshot(userId);
      } catch (e) {
        console.warn("recordPortfolioSnapshot bootstrap", e);
      }
    }

    const [bundle, history] = await Promise.all([
      getPortfolioBundle(userId, base),
      getPortfolioHistory(userId, base),
    ]);

    return NextResponse.json({
      summary: bundle.summary,
      allocation: bundle.allocation,
      history,
      baseCurrency: base,
    });
  } catch (e) {
    console.error("GET /api/portfolio", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur portfolio" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = portfolioBaseCurrencySchema.safeParse(body ?? {});
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const baseCurrency = parsed.data.baseCurrency;
  await prisma.user.update({
    where: { id: userId },
    data: { baseCurrency },
  });
  return NextResponse.json({ baseCurrency });
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getDefiBundle } from "@/app/lib/crypto/defi-service";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/crypto/defi
 *
 * Positions DeFi valorisées depuis le journal. Rien n'est stocké en agrégat :
 * les totaux ne peuvent donc pas diverger de l'onglet Positions.
 *
 * Les Decimal sont rendus en chaînes — précision préservée jusqu'au navigateur.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const bundle = await getDefiBundle(userId);

    return NextResponse.json(
      {
        positions: bundle.positions.map((p) => ({
          id: p.id,
          protocol: p.protocol,
          chain: p.chain,
          positionType: p.positionType,
          assetSymbol: p.assetSymbol,
          valueEur: p.valueEur.toFixed(2),
          netValueEur: p.netValueEur.toFixed(2),
          isDebt: p.isDebt,
          rewardsValueEur: p.rewardsValueEur?.toFixed(2) ?? null,
          apyPct: p.apyPct?.toFixed(2) ?? null,
          healthFactor: p.healthFactor,
          ltvPct: p.ltvPct,
          healthRisk: p.healthRisk,
          ltvRisk: p.ltvRisk,
        })),
        byProtocol: bundle.byProtocol.map((g) => ({
          protocol: g.protocol,
          chains: g.chains,
          depositedEur: g.depositedEur.toFixed(2),
          borrowedEur: g.borrowedEur.toFixed(2),
          netEur: g.netEur.toFixed(2),
          positionIds: g.positions.map((p) => p.id),
        })),
        byType: bundle.byType.map((g) => ({
          positionType: g.positionType,
          totalEur: g.totalEur.toFixed(2),
          positionIds: g.positions.map((p) => p.id),
        })),
        summary: {
          depositedEur: bundle.summary.depositedEur.toFixed(2),
          borrowedEur: bundle.summary.borrowedEur.toFixed(2),
          netEur: bundle.summary.netEur.toFixed(2),
          pendingRewardsEur: bundle.summary.pendingRewardsEur.toFixed(2),
          weightedApyPct: bundle.summary.weightedApyPct?.toFixed(2) ?? null,
          positionCount: bundle.summary.positionCount,
          protocolCount: bundle.summary.protocolCount,
          worstHealthFactor: bundle.summary.worstHealthFactor,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[crypto/defi GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des positions DeFi") },
      { status: 500 }
    );
  }
}

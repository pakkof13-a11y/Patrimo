import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getAssetPriceHistory } from "@/app/lib/market/price-history";
import { parseHistoryRange } from "@/app/lib/market/price-history-types";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const range = parseHistoryRange(searchParams.get("range"));
  /** ISO date du 1er achat — étend 5y/all en arrière pour la perf */
  const sinceRaw = searchParams.get("since");
  const since =
    sinceRaw && !Number.isNaN(new Date(sinceRaw).getTime()) ? sinceRaw : null;

  try {
    const history = await getAssetPriceHistory(userId, id, range, { since });
    if (!history) {
      return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
    }
    return NextResponse.json(history);
  } catch (e) {
    console.error("[asset-history]", e);
    return NextResponse.json({ error: "Erreur historique" }, { status: 500 });
  }
}

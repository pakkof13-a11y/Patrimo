import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  defaultWindow,
  getClassPnlSeries,
} from "@/app/lib/portfolio/class-pnl-service";

/** Profondeur en jours civils par plage UI. */
const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "1m": 31,
  "3m": 93,
  "6m": 184,
  "1y": 366,
};

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "1m";
  const days = RANGE_DAYS[range] ?? RANGE_DAYS["1m"]!;
  const { fromDay, toDay } = defaultWindow(days);

  try {
    const series = await getClassPnlSeries(userId, fromDay, toDay);
    return NextResponse.json({ range, fromDay, toDay, ...series });
  } catch (e) {
    console.error("[class-pnl]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de calcul du P&L par classe") },
      { status: clientErrorStatus(e) }
    );
  }
}

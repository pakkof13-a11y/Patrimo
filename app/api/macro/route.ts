import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { resolveMacroCalendarToday } from "@/app/lib/news/macro-live";

/**
 * GET /api/macro — calendrier économique du jour.
 * Source live : calendrier public type Investing/FF (JSON faireconomy).
 * Fallback mock si indisponible.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { events, source, date } = await resolveMacroCalendarToday();

  return NextResponse.json({
    events,
    source,
    date,
    generatedAt: new Date().toISOString(),
  });
}

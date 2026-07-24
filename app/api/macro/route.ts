import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { resolveMacroCalendarToday } from "@/app/lib/news/macro-live";
import { isMacroEventPublished } from "@/app/lib/news/service";

/**
 * GET /api/macro — calendrier économique du jour.
 * Source live : calendrier public type Investing/FF (JSON faireconomy).
 * Fallback mock si indisponible.
 * Sépare déjà côté serveur « À venir » (pas de réel) / « Publiées » (réel dispo).
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { events, source, date } = await resolveMacroCalendarToday();
  const now = new Date();

  return NextResponse.json({
    events,
    upcoming: events.filter((e) => !isMacroEventPublished(e, now)),
    published: events.filter((e) => isMacroEventPublished(e, now)),
    source,
    date,
    generatedAt: now.toISOString(),
  });
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { resolveMacroCalendarWeek } from "@/app/lib/news/macro-live";

/**
 * GET /api/macro — calendrier économique de la semaine.
 * Source live : calendrier public type Investing/FF (JSON faireconomy).
 * Fallback mock si indisponible.
 * Sépare côté serveur « À venir » / « Passés » sur l’heure de l’événement.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { events, source, date } = await resolveMacroCalendarWeek();
  const now = new Date();
  const nowMs = now.getTime();

  /*
    « À venir » et « Passés » se départagent sur l'heure, pas sur la présence
    du chiffre.

    La règle précédente lisait `isMacroEventPublished` : un événement passait
    dans « Passés » quand son `actual` arrivait. Or un indicateur qui porte une
    prévision mais dont le fournisseur ne publie jamais le réel — cas courant
    sur les séries secondaires — restait « à venir » indéfiniment, des jours
    après son heure. C'est ce que l'écran montrait : des publications annoncées
    à venir alors qu'elles étaient sorties.

    Le temps tranche, et lui seul. `isMacroEventPublished` garde son sens — le
    chiffre est-il tombé — et sert le badge, qui répond à une autre question.

    Les deux listes sont complémentaires par construction (`>` et `<=` sur le
    même instant) : aucun événement ne peut manquer aux deux ni figurer dans
    les deux.
  */
  const timeOf = (e: { time: string }) => Date.parse(e.time);
  const upcoming = events.filter((e) => {
    const t = timeOf(e);
    return !Number.isFinite(t) || t > nowMs;
  });
  const published = events.filter((e) => {
    const t = timeOf(e);
    return Number.isFinite(t) && t <= nowMs;
  });

  return NextResponse.json({
    events,
    upcoming,
    published,
    source,
    date,
    generatedAt: now.toISOString(),
  });
}

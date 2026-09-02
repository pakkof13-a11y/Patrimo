import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { buildIntradaySeries } from "@/app/lib/portfolio/intraday/series";

/**
 * GET /api/portfolio/intraday?days=7&maxPoints=400
 *
 * Série patrimoniale à pas horaire, reconstruite depuis les `AssetIntradayBar`
 * réellement collectées.
 *
 * ## Lecture pure
 *
 * Aucune écriture, aucun appel fournisseur. Les cours manquants ne sont pas
 * cherchés en ligne : une fenêtre sans collecte rend une série vide, avec
 * `observedFrom: null`. C'est la règle établie sur les passifs — consulter un
 * écran ne modifie rien — et celle du chantier de collecte : l'affichage ne
 * dépend pas du réseau.
 *
 * ## Contrat métier, pas contrat de graphe
 *
 * La réponse ne porte aucune forme propre à une bibliothèque de rendu. Le
 * chantier suivant construira la restitution visuelle à partir de cette
 * structure ; il ne doit pas pouvoir la déformer en retour.
 */

/** Fenêtres proposées, en jours. 7 est la priorité du chantier. */
const MAX_DAYS = 31;
const DEFAULT_DAYS = 7;

/**
 * Plafond de points renvoyés.
 *
 * Une fenêtre de 31 jours en pas horaire fait 744 instants ; cinq ans en
 * feraient 43 800. Le plafond borne la réponse, et `downsampleIntraday`
 * préserve extrêmes, flux et changements de statut plutôt que d'échantillonner
 * régulièrement — c'est ce qui empêche un creux de milieu de journée de
 * disparaître au passage.
 */
const DEFAULT_MAX_POINTS = 400;
const HARD_MAX_POINTS = 2000;

function intParam(raw: string | null, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const days = intParam(params.get("days"), DEFAULT_DAYS, 1, MAX_DAYS);
  const maxPoints = intParam(
    params.get("maxPoints"),
    DEFAULT_MAX_POINTS,
    3,
    HARD_MAX_POINTS
  );

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const series = await buildIntradaySeries({ userId, from, to, maxPoints });

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    ...series,
  });
}

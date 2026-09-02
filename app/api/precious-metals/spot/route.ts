import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  getMetalSpots,
  readMetalSpots,
  QUOTED_METALS,
} from "@/app/lib/market/metal-spot";

export const dynamic = "force-dynamic";

/**
 * Cours des métaux précieux, en euro par gramme de métal fin.
 *
 * GET lit le cache sans toucher au réseau : l'écran s'affiche toujours, même
 * fournisseur muet, avec la date du cours pour que son âge soit visible.
 * POST déclenche le rafraîchissement — un geste explicite, comme le bouton
 * d'actualisation des cours du portefeuille.
 *
 * Le cache n'appartient à personne : un cours de l'or est le même pour tous.
 * L'authentification reste exigée pour ne pas offrir un proxy de cotation
 * gratuit à qui passerait par là.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const spots = await readMetalSpots();
    return NextResponse.json({
      spots: Object.fromEntries(spots),
      metals: QUOTED_METALS,
    });
  } catch (e) {
    console.error("[precious-metals/spot GET]", e);
    return NextResponse.json(
      { error: "Cours indisponibles" },
      { status: 500 }
    );
  }
}

export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const spots = await getMetalSpots();
    /*
      Un fournisseur muet n'est pas une erreur serveur : la réponse dit
      simplement quels métaux restent sans cours, à charge pour l'écran de
      l'annoncer plutôt que d'afficher une valorisation fantôme.
    */
    const missing = QUOTED_METALS.filter((m) => !spots.has(m));
    return NextResponse.json({
      spots: Object.fromEntries(spots),
      missing,
    });
  } catch (e) {
    console.error("[precious-metals/spot POST]", e);
    return NextResponse.json(
      { error: "Rafraîchissement impossible" },
      { status: 502 }
    );
  }
}

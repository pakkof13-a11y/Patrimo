import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { parisDayKey } from "@/app/lib/dates/paris";
import {
  assetsNeedingFetch,
  getDailyCloses,
  readDailyCloses,
} from "@/app/lib/market/daily-closes";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";

/**
 * Vignettes de tendance des lignes du portefeuille.
 *
 * Une requête pour toutes les lignes affichées, et non une par ligne : sur un
 * portefeuille de trente positions, la seconde solution ferait trente
 * aller-retours pour dessiner trente courbes de quelques pixels.
 *
 * **Le cache d'abord, quelques appels ensuite.** On lit `AssetDailyClose`, et
 * on ne complète que les actifs qu'il ignore encore — au plus une poignée par
 * requête. Tout remplir d'un coup ferait payer trente téléchargements
 * d'historique à l'ouverture du portefeuille ; ne rien remplir laisserait la
 * colonne vide jusqu'à ce qu'un autre écran passe par là, ce qui se lit comme
 * une panne. Un portefeuille froid se peuple donc en quelques visites, et
 * immédiatement dès que le P&L par classe tourne sur la même page — il remplit
 * le même cache pour les mêmes actifs.
 *
 * Un actif que les fournisseurs ignorent n'a pas de vignette, et c'est le
 * comportement voulu : une diagonale tracée entre deux points inventés aurait
 * l'apparence d'une tendance sans en être une.
 */

/** Fenêtre de la vignette : un mois de clôtures donne une pente lisible. */
const WINDOW_DAYS = 30;

/**
 * Plafond du nombre d'actifs par requête.
 *
 * Le portefeuille n'affiche jamais autant de lignes d'un coup, mais l'URL est
 * publique : sans borne, un appelant pourrait demander l'historique de la base
 * entière en une fois.
 */
const MAX_ASSETS = 120;

/** En dessous, la « courbe » est un segment : on n'en dessine pas. */
const MIN_POINTS = 2;

/**
 * Actifs complétés depuis les fournisseurs au cours d'une même requête.
 *
 * Le chiffre est délibérément petit : il borne le coût du pire cas — un
 * portefeuille entier dont le cache est vide — à l'équivalent de quelques
 * fiches d'actif ouvertes. Le reste se remplit à la visite suivante.
 */
const MAX_FILLS_PER_REQUEST = 8;

export type SparklinesResponse = {
  /** Clôtures par actif, du plus ancien au plus récent. */
  series: Record<string, number[]>;
  fromDay: string;
  toDay: string;
};

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("ids") || "";
  const requested = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_ASSETS);

  if (requested.length === 0) {
    const today = parisDayKey(new Date());
    return NextResponse.json({ series: {}, fromDay: today, toDay: today });
  }

  try {
    /*
      Les identifiants viennent du client : on ne rend que les actifs de
      l'utilisateur. Sans ce filtre, connaître un identifiant suffirait à lire
      l'historique de cours d'un autre compte.
    */
    const owned = await prisma.asset.findMany({
      where: { userId, id: { in: requested } },
      select: { id: true },
    });
    const ownedIds = owned.map((a) => a.id);

    const now = new Date();
    const toDay = parisDayKey(now);
    const fromDay = parisDayKey(
      new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000)
    );

    /*
      Complément best effort, jamais bloquant : un fournisseur muet laisse la
      ligne sans vignette, il ne fait pas échouer la requête. Le tableau lui
      est déjà affiché — ces courbes l'enrichissent, elles ne le portent pas.

      Le remplissage est délégué au service partagé plutôt que refait ici : il
      borne sa concurrence et avale les erreurs actif par actif. La boucle
      séquentielle qui traînait à cette place attendait chaque fournisseur à
      son tour — huit actifs froids, huit attentes bout à bout, pour une
      colonne d'illustration.

      `assetsNeedingFetch` est appelé ici pour décider *qui* compléter, parce
      que le plafond doit porter sur les actifs à combler et non sur les huit
      premiers de la liste : un portefeuille dont les huit premières lignes
      sont déjà en cache ne comblerait jamais les suivantes.
    */
    const stale = await assetsNeedingFetch(ownedIds, toDay, now);
    const toFill = stale.slice(0, MAX_FILLS_PER_REQUEST);
    if (toFill.length > 0) {
      await getDailyCloses(userId, toFill, fromDay, toDay, { now });
    }

    const index = await readDailyCloses(ownedIds, fromDay, toDay);

    const series: Record<string, number[]> = {};
    for (const [assetId, byDay] of index) {
      // Les clés sont des jours ISO : l'ordre alphabétique est l'ordre
      // chronologique, et évite de reparser trente dates par actif.
      const closes = [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([, close]) => close);
      if (closes.length >= MIN_POINTS) series[assetId] = closes;
    }

    return NextResponse.json({ series, fromDay, toDay });
  } catch (e) {
    console.error("[portfolio/sparklines]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Tendances indisponibles") },
      { status: clientErrorStatus(e) }
    );
  }
}

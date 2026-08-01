import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { parisDayKey } from "@/app/lib/dates/paris";
import { readDailyCloses } from "@/app/lib/market/daily-closes";
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
 * **Lecture seule du cache.** On lit `AssetDailyClose` sans jamais déclencher
 * d'appel fournisseur, comme le fait déjà le bandeau KPI crypto. La raison est
 * la même : ouvrir le portefeuille ne doit pas coûter trente téléchargements
 * d'historique. Un actif absent du cache n'a donc pas de vignette — et c'est
 * préférable à une diagonale tracée entre deux points inventés, qui aurait
 * l'apparence d'une tendance sans en être une. Le cache se remplit quand
 * l'utilisateur ouvre une vue qui en a besoin (P&L par classe, crypto
 * comptant, fiche d'un actif).
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

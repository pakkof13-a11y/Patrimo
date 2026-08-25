import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { timingSafeEqualSecret } from "@/app/lib/env/runtime";
import {
  collectIntradayBars,
  DEFAULT_INTRADAY_INTERVAL,
  isIntradayInterval,
} from "@/app/lib/market/intraday-collector";
import { parseBarInterval } from "@/app/lib/market/price-history-types";
import { readCronCredential } from "@/app/lib/auth/cron-credential";

/**
 * Collecte planifiée des barres intra-séance.
 *
 * ## Deux modes, comme `/api/savings/accrue`
 *
 * - **cron** : `Authorization: Bearer $CRON_SECRET` ou `x-cron-secret` →
 *   parcourt tous les comptes.
 * - **utilisateur** (POST seulement) : session authentifiée → ne collecte que
 *   ses actifs. Sert à amorcer un compte ou à diagnostiquer ; aucun écran ne
 *   l'appelle.
 *
 * ## Pourquoi une tâche planifiée, et pas une collecte à l'affichage
 *
 * Une lecture ne doit pas dépendre du réseau fournisseur. Brancher la collecte
 * sur l'ouverture du graphique rendrait le tableau de bord tributaire de Yahoo
 * et ferait dépendre l'historique de qui regarde, et quand — le défaut même
 * corrigé sur les passifs, où consulter un écran écrivait en base.
 *
 * ## Pourquoi un GET qui écrit
 *
 * Vercel Cron déclenche ses tâches en GET ; le verbe est imposé par la
 * plateforme, pas choisi. Ce GET n'est donc pas un chemin de lecture : il
 * **exige le secret** et n'offre aucun repli utilisateur, si bien qu'aucune
 * session ne peut l'atteindre. Sans secret configuré, il répond 401 et
 * n'écrit rien. Le mode utilisateur, lui, reste en POST.
 */

/**
 * Le proxy laisse passer une requête qui *présente* une créance de cron ; c'est
 * ici qu'elle est réellement vérifiée, en temps constant.
 */
function isCronRequest(req: Request): boolean {
  return timingSafeEqualSecret(readCronCredential(req), "CRON_SECRET");
}

/**
 * Granularité demandée, validée deux fois.
 *
 * `parseBarInterval` admet les cinq intervalles du graphique d'un actif ;
 * `isIntradayInterval` en retire `1d` et `1wk`, dont la clôture a déjà sa
 * table. Une valeur inconnue retombe sur le défaut plutôt que d'ouvrir une
 * seconde résolution par accident.
 */
function intervalOf(req: Request) {
  const asked = parseBarInterval(new URL(req.url).searchParams.get("interval"));
  return asked && isIntradayInterval(asked) ? asked : DEFAULT_INTRADAY_INTERVAL;
}

export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const report = await collectIntradayBars({ interval: intervalOf(req) });
  return NextResponse.json({ mode: "cron", ...report });
}

export async function POST(req: Request) {
  const interval = intervalOf(req);

  if (isCronRequest(req)) {
    const report = await collectIntradayBars({ interval });
    return NextResponse.json({ mode: "cron", ...report });
  }

  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const report = await collectIntradayBars({ userId, interval });
  return NextResponse.json({ mode: "user", ...report });
}

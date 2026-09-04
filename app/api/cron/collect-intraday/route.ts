import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { timingSafeEqualSecret } from "@/app/lib/env/runtime";
import {
  collectDailyClosesForAssets,
  collectIntradayBars,
  DEFAULT_INTRADAY_INTERVAL,
  isIntradayInterval,
} from "@/app/lib/market/intraday-collector";
import { backfillDailyClosesFromFirstTx } from "@/app/lib/market/backfill-closes";
import { parseBarInterval } from "@/app/lib/market/price-history-types";
import { readCronCredential } from "@/app/lib/auth/cron-credential";

/**
 * Collecte planifiée des données de marché.
 *
 * Deux entretiens en un passage : les barres intra-séance, et les clôtures
 * quotidiennes. Cette seconde partie n'était alimentée qu'en marge d'une
 * consultation — un compte qui n'ouvrait jamais d'écran d'historique
 * n'accumulait donc rien, alors que c'est cette table qui rend le passé
 * reconstructible. Une lecture, elle, ne déclenche plus rien de nouveau.
 *
 * ## Deux modes, comme `/api/savings/accrue`
 *
 * - **cron** : `Authorization: Bearer $CRON_SECRET` ou `x-cron-secret` →
 *   parcourt tous les comptes.
 * - **utilisateur** (POST seulement) : session authentifiée → ne collecte que
 *   ses actifs. Sert à amorcer un compte ou à diagnostiquer ; aucun écran ne
 *   l'appelle.
 *
 * ## Cadence : une fois par jour, et c'est suffisant
 *
 * `vercel.json` planifie ce passage à 03 h 05, une seule fois par jour. Une
 * cadence horaire a été essayée et **cassait le déploiement** : l'offre Hobby
 * de Vercel refuse toute planification plus fréquente que quotidienne, et le
 * déploiement échoue au lieu de se dégrader.
 *
 * La granularité n'en souffre pas. Le collecteur ne demande pas « la barre de
 * maintenant » mais une **fenêtre** — dix jours en pas horaire — et persiste
 * toutes celles qui sont closes. Un passage quotidien ramène donc les vingt-
 * quatre barres de la veille d'un coup ; seule la fraîcheur change, pas la
 * finesse. La clé `(assetId, interval, barStart)` rend les recouvrements
 * inoffensifs.
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

/**
 * Les deux entretiens d'un passage.
 *
 * L'intraday d'abord — c'est lui qui a une fenêtre fournisseur courte, donc le
 * plus à perdre en cas d'interruption. Les clôtures suivent : leur fenêtre est
 * large et un passage manqué se rattrape.
 *
 * L'échec de l'un ne doit pas emporter l'autre : ils entretiennent deux caches
 * distincts, et perdre les deux parce qu'un fournisseur est muet serait
 * doublement coûteux.
 */
async function collectAll(opts: {
  interval: ReturnType<typeof intervalOf>;
  userId?: string;
}) {
  const intraday = await collectIntradayBars({
    interval: opts.interval,
    ...(opts.userId ? { userId: opts.userId } : {}),
  });

  let daily;
  try {
    // T-04 : depuis le premier achat par ticker, pas seulement 365 jours.
    // `collectDailyClosesForAssets` reste l'entretien court ; le backfill
    // couvre la profondeur. Un cache déjà complet est un no-op (fraîcheur).
    daily = await backfillDailyClosesFromFirstTx(
      opts.userId ? { userId: opts.userId } : undefined
    );
  } catch (e) {
    try {
      daily = await collectDailyClosesForAssets(
        opts.userId ? { userId: opts.userId } : undefined
      );
    } catch (e2) {
      daily = {
        assetsConsidered: 0,
        assetsStale: 0,
        assetsFilled: 0,
        closesWritten: 0,
        errors: [
          {
            assetId: "-",
            message: e2 instanceof Error ? e2.message : e instanceof Error ? e.message : "échec",
          },
        ],
        day: "",
      };
    }
  }


  return { intraday, daily };
}

export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  return NextResponse.json({
    mode: "cron",
    ...(await collectAll({ interval: intervalOf(req) })),
  });
}

export async function POST(req: Request) {
  const interval = intervalOf(req);

  if (isCronRequest(req)) {
    return NextResponse.json({ mode: "cron", ...(await collectAll({ interval })) });
  }

  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  return NextResponse.json({
    mode: "user",
    ...(await collectAll({ interval, userId })),
  });
}

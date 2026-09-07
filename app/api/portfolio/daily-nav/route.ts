import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  defaultDailyNavWindow,
  getDailyNav,
  isDailyNavScope,
  parseDayKey,
  type DailyNavScope,
} from "@/app/lib/portfolio/historical/get-daily-nav";
import { lastCloseDay } from "@/app/lib/portfolio/historical/history-window";
import { compressDailyNavPoints } from "@/app/lib/portfolio/historical/daily-nav-compress";

/**
 * GET /api/portfolio/daily-nav?scope=financier&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * `getDailyNav` rend une série T-05 au pas décidé par l'étendue servie : un
 * point par jour civil jusqu'à ~1 an, un point par semaine civile (dimanche)
 * au-delà. Le pas est publié dans `step` et dans `intervalType` de chaque
 * point — le client le lit, il ne le recalcule pas. Lecture pure : aucune
 * collecte de clôtures.
 *
 * La réponse HTTP, elle, comprime les suites de jours strictement identiques
 * (cf. `daily-nav-compress.ts`) : c'est ce qui évite qu'un « Tout » sur un
 * patrimoine à plateau (années sans écriture entre deux acquisitions) ne
 * traîne des milliers de points superposés jusqu'au client. Sur une tranche
 * dense, rien n'est retiré — le contrat T-05 survit intact à l'écran.
 *
 * `scope` défaut : `financier` (courbe Finary). `from`/`to` défaut : 1 an.
 *
 * Vague2 D4 / D11 : l'enveloppe porte `asOfDay` (dernier point) et
 * `fetchedAt` (plus ancienne collecte des dernières clôtures). Hero, KPI
 * et watchlist lisent cette date — pas une horloge ni `PriceQuote` seul.
 *
 * Budget de la fonction : aucun `maxDuration` n'était posé ici ni dans
 * `vercel.json`, alors que le commentaire de `history-window.ts` enregistre
 * 8 813 ms mesurés en préproduction sur la fenêtre 5A/Tout — contre un 504
 * observé (7d2bc7b) à 10 238 ms sur `GET /api/portfolio` sans `maxDuration`
 * non plus. Ce chiffre colle au plafond par défaut du plan Hobby côté
 * Vercel (10 s sans configuration), pas aux soixante secondes du plan : une
 * fenêtre profonde a donc peu de marge avant de retomber dans le même 504
 * que la séparation instantané/série devait éliminer. Le plan Hobby autorise
 * `maxDuration` jusqu'à 60 s (300 s est réservé au plan Pro — piste fermée,
 * déjà tentée à tort sur ce dépôt) : 60 est la valeur la plus haute
 * réellement permise, posée ici pour donner à la fenêtre profonde la marge
 * que le défaut ne lui laissait pas. Non mesuré : le comportement réel en
 * préproduction après ce changement — seul un déploiement le dira.
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  /*
    `?scope=` absent **ou vide** retombe sur le défaut documenté : un client
    qui construit sa requête avec une variable éventuellement vide ne doit pas
    recevoir un 400 pour une valeur qu'il n'a jamais eu l'intention de fixer.
    `?scope=` présent avec une valeur non reconnue reste une erreur.
  */
  const scopeParam = params.get("scope");
  const scopeRaw = scopeParam ? scopeParam : "financier";
  if (!isDailyNavScope(scopeRaw)) {
    return NextResponse.json(
      {
        error:
          "scope invalide — financier | brut | net | listed | immobilier | av | cash | alternatifs | employeeSavings | autre",
      },
      { status: 400 }
    );
  }
  const scope: DailyNavScope = scopeRaw;

  /*
    `from`/`to` absents retombent sur le défaut (1 an, jusqu'à `lastCloseDay`).
    Présents mais malformés ou de date calendaire inexistante (`parseDayKey`
    valide désormais le round-trip, pas la seule forme) : 400, jamais un
    repli silencieux sur le défaut — un `?from=2026-1-5` malformé ne doit pas
    se travestir en fenêtre d'un an que personne n'a demandée.
  */
  const defaults = defaultDailyNavWindow();
  const fromRaw = params.get("from");
  const toRaw = params.get("to");

  let from = defaults.from;
  if (fromRaw != null) {
    const parsed = parseDayKey(fromRaw);
    if (!parsed) {
      return NextResponse.json(
        { error: "from invalide — attendu YYYY-MM-DD, date calendaire réelle" },
        { status: 400 }
      );
    }
    from = parsed;
  }

  let to = defaults.to;
  if (toRaw != null) {
    const parsed = parseDayKey(toRaw);
    if (!parsed) {
      return NextResponse.json(
        { error: "to invalide — attendu YYYY-MM-DD, date calendaire réelle" },
        { status: 400 }
      );
    }
    to = parsed;
  }

  /*
    `to` n'était vérifié que de forme : `?to=2200-01-01` atteignait
    `buildSeries`, dont `enumerateDays` plafonne à 20 000 jours — le journal
    rejoué vingt mille fois pour une réponse qui aurait valorisé des dates
    n'ayant pas eu lieu, par report du dernier cours connu. `from` est déjà
    ramené sous le cap par le moteur (`capEarliestDay` / `earliestDayForScope`)
    — `to`, lui, n'avait pas d'équivalent côté route.
  */
  const cappedTo = lastCloseDay();
  if (to > cappedTo) to = cappedTo;

  if (from > to) {
    return NextResponse.json(
      { error: "from postérieur à to" },
      { status: 400 }
    );
  }

  try {
    const result = await getDailyNav({ userId, scope, from, to });
    return NextResponse.json({
      ...result,
      points: compressDailyNavPoints(result.points),
    });
  } catch (e) {
    console.error("[daily-nav]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de calcul de la NAV quotidienne") },
      { status: clientErrorStatus(e) }
    );
  }
}

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
import { compressDailyNavPoints } from "@/app/lib/portfolio/historical/daily-nav-compress";

/**
 * GET /api/portfolio/daily-nav?scope=financier&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * `getDailyNav` rend une série dense T-05 : un point par jour civil, scopes
 * PatrimonyMetrics. Lecture pure — aucune collecte de clôtures.
 *
 * La réponse HTTP, elle, comprime les suites de jours strictement identiques
 * (cf. `daily-nav-compress.ts`) : c'est ce qui évite qu'un « Tout » sur un
 * patrimoine à plateau (années sans écriture entre deux acquisitions) ne
 * traîne des milliers de points superposés jusqu'au client. Sur une tranche
 * dense, rien n'est retiré — le contrat T-05 survit intact à l'écran.
 *
 * `scope` défaut : `financier` (courbe Finary). `from`/`to` défaut : 1 an.
 */

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const scopeRaw = params.get("scope") ?? "financier";
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

  const defaults = defaultDailyNavWindow();
  const from = parseDayKey(params.get("from")) ?? defaults.from;
  const to = parseDayKey(params.get("to")) ?? defaults.to;

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

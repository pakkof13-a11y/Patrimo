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

/**
 * GET /api/portfolio/daily-nav?scope=financier&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Série dense T-05 : un point par jour civil, scopes PatrimonyMetrics.
 * Lecture pure — aucune collecte de clôtures.
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
          "scope invalide — financier | brut | net | listed | immobilier | av | cash | alternatifs | employeeSavings | autre | passifs",
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
    return NextResponse.json(result);
  } catch (e) {
    console.error("[daily-nav]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de calcul de la NAV quotidienne") },
      { status: clientErrorStatus(e) }
    );
  }
}

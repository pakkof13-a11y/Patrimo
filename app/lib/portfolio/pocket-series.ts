/**
 * D18 — filtres de compte (Titres / Assurance-vie / Immo / Cash / …) sur la
 * série daily-nav.
 *
 * Le hero demande déjà `from`/`to` ; `getDailyNav` ramène `from` à
 * `earliestDayForScope`. Les filtres doivent **la même fenêtre**, le même
 * clamp, et ne dire « Période trop courte » que s'il reste moins de deux
 * points **après** ce clamp.
 *
 * Immo / cash / alternatifs / épargne salariale se dessinent en marches : une
 * expertise vaut jusqu'à la suivante. Interpoler entre deux constats
 * inventerait des valeurs que le moteur s'interdit.
 *
 * « Compte », pas « Catégorie ». `byAssetClass` agrège l'`assetClass` brute
 * sans le compte qui la porte — une unité de compte d'assurance-vie classée
 * `ACTIONS` s'y additionne avec un titre PEA, comptant l'assurance-vie deux
 * fois. Le compte Titres lit donc exclusivement le croisement
 * `byAssetClassAndEnvelope` (PEA/CTO), jamais `byAssetClass`.
 */

import { endOfParisDay } from "../dates/paris";
import type { EvolutionAccount } from "./evolution-prefs";
import type { EvolutionSeriesPoint } from "./evolution-aggregate";
import {
  windowDailyNav,
  type DailyNavChartPoint,
} from "./daily-nav-view";
import type { EvolutionRange } from "./evolution-aggregate";
import type {
  DailyNavPoint,
  DailyNavScope,
} from "./historical/get-daily-nav";

/** Moins de deux points après clamp : rien à tracer, pas une courbe plate. */
export const MIN_POCKET_SERIES_POINTS = 2;

/**
 * Comptes illiquides : le moteur reconduit la dernière expertise (LOCF).
 * Un trait linéaire entre deux constats éloignés interpolerait.
 */
export const ILLIQUID_POCKET_ACCOUNTS = new Set<EvolutionAccount>([
  "IMMOBILIER",
  "CASH",
  "ALTERNATIFS",
  "EPARGNE_SALARIALE",
]);

export function isIlliquidPocketAccount(
  account: EvolutionAccount | null | undefined
): boolean {
  return account != null && ILLIQUID_POCKET_ACCOUNTS.has(account);
}

export function pocketChartLineType(
  account: EvolutionAccount | null | undefined
): "linear" | "stepAfter" {
  return isIlliquidPocketAccount(account) ? "stepAfter" : "linear";
}

/**
 * Dernière expertise connue au jour `day` — LOCF / palier.
 *
 * Entre deux valorisations on reconduit la précédente. Une moyenne ou un
 * lerp `(v0 + (v1−v0)·t)` n'est pas une observation : c'est interdit.
 */
export function locfValueAt(
  appraisals: ReadonlyArray<{ day: string; value: number }>,
  day: string
): number | null {
  let held: number | null = null;
  for (const a of appraisals) {
    if (a.day > day) break;
    held = a.value;
  }
  return held;
}

/**
 * Scope `getDailyNav` dont `earliestDayForScope` borne le filtre.
 *
 * Titres et crypto partagent la poche `listed` — Titres y lit ensuite le
 * croisement `byAssetClassAndEnvelope`, crypto son entrée `byAssetClass`.
 * Les autres comptes portent chacun leur propre scope dense.
 */
export function dailyNavScopeForAccount(
  account: EvolutionAccount
): DailyNavScope {
  switch (account) {
    case "IMMOBILIER":
      return "immobilier";
    case "CASH":
      return "cash";
    case "ASSURANCE_VIE":
      return "av";
    case "ALTERNATIFS":
      return "alternatifs";
    case "EPARGNE_SALARIALE":
      return "employeeSavings";
    case "TITRES":
    case "CRYPTO":
      return "listed";
  }
}

/**
 * Si la fenêtre demandée précède la première observation du scope, on la
 * ramène à cette borne — jamais une série fantôme avant, jamais un écran
 * vide sous prétexte que `from` est trop ancien.
 */
export function clampRequestedFrom(
  requestedFrom: string,
  earliestDayForScope: string | null
): string | null {
  if (earliestDayForScope == null) return null;
  return requestedFrom < earliestDayForScope
    ? earliestDayForScope
    : requestedFrom;
}

export function pocketSeriesTooShort(
  points: readonly unknown[]
): boolean {
  return points.length < MIN_POCKET_SERIES_POINTS;
}

export const POCKET_EMPTY_TITLE = "Pas encore d’historique sur cette poche";
export const PERIOD_TOO_SHORT_TITLE = "Période trop courte";

/**
 * Copie d'écran après clamp : 0 point n'est pas « période trop courte ».
 * Une poche née hier n'a simplement pas d'historique à tracer.
 */
export function pocketEmptyState(pointCount: number): {
  kind: "empty" | "too-short";
  title: string;
  description: string;
} | null {
  if (pointCount >= MIN_POCKET_SERIES_POINTS) return null;
  if (pointCount === 0) {
    return {
      kind: "empty",
      title: POCKET_EMPTY_TITLE,
      description:
        "Cette poche n’a pas encore de valorisation sur la fenêtre affichée.",
    };
  }
  return {
    kind: "too-short",
    title: PERIOD_TOO_SHORT_TITLE,
    description:
      "Choisissez une plage plus large ou attendez davantage d'historique.",
  };
}

/**
 * Fenêtre UI (6M, Tout, …) sur une série déjà clampée par `getDailyNav`.
 *
 * `servedFrom` est la borne **servie**, pas celle demandée : un « Tout »
 * financier ne doit pas réintroduire les jours d'avant la poche.
 */
export function windowPocketDailyNav(
  points: DailyNavPoint[],
  range: EvolutionRange,
  referenceDay: string,
  servedFrom?: string | null
): DailyNavPoint[] {
  const windowed = windowDailyNav(points, range, referenceDay);
  if (!servedFrom) return windowed;
  return windowed.filter((p) => p.day >= servedFrom);
}

/**
 * Valeur Titres à un jour donné — croisement classe × enveloppe, jamais
 * `byAssetClass`.
 *
 * Sans enveloppe (« Tout Titres ») : PEA + CTO, additionnés pour ACTIONS et
 * OBLIGATIONS — les seules classes que `ENVELOPE_CAPABLE_CLASSES` reconnaît.
 * `UNKNOWN` (CFD, ou titres dont l'enveloppe n'est pas encore démontrée) en
 * est délibérément exclu : ce n'est pas un compte-titres, et l'additionner
 * ferait passer une exposition CFD ou une absence de constat pour une valeur
 * PEA/CTO. `titresUnknownEnvelopeEur` porte cette part à part.
 *
 * Avec enveloppe (PEA ou CTO seule) : la somme des deux classes pour cette
 * seule enveloppe.
 *
 * `null` dès qu'une des briques manque — UNKNOWN ≠ ZERO : une absence de
 * constat n'est pas une valeur nulle, et la sommer comme telle inventerait un
 * point de courbe.
 */
export function titresValueAt(
  point: DailyNavPoint,
  envelope?: "PEA" | "CTO" | null
): number | null {
  const actions = point.byAssetClassAndEnvelope?.ACTIONS;
  const obligations = point.byAssetClassAndEnvelope?.OBLIGATIONS;
  if (!actions || !obligations) return null;
  if (envelope) {
    const a = actions[envelope];
    const o = obligations[envelope];
    if (a == null || o == null) return null;
    return a + o;
  }
  const { PEA: aPea, CTO: aCto } = actions;
  const { PEA: oPea, CTO: oCto } = obligations;
  if (aPea == null || aCto == null || oPea == null || oCto == null) {
    return null;
  }
  return aPea + aCto + oPea + oCto;
}

/**
 * Part de l'exposition titres qui n'est ni PEA ni CTO — CFD non historisé,
 * ou enveloppe pas encore démontrée par le journal. Alimente la ligne
 * d'écart « hors comptes-titres » sous le panneau, jamais la courbe.
 */
export function titresUnknownEnvelopeEur(point: DailyNavPoint): number | null {
  /*
    L'exposition cotée qu'aucun compte-titres ne porte.

    Première rédaction : la somme des cases `UNKNOWN` du croisement. Mesuré
    après le commit `2c3eaa4`, qui date les événements d'enveloppe du seed sur
    l'acquisition des lignes, cette somme vaut **zéro** — l'enveloppe de chaque
    ligne est désormais connue sur toute sa profondeur. La ligne d'écart ne se
    serait donc jamais affichée, alors même que l'écart existe.

    Surtout, elle mesurait la mauvaise chose. Un CFD n'a pas une enveloppe
    « inconnue » : il n'a pas d'enveloppe titres du tout, et n'entre dans aucune
    case du croisement. Chercher l'écart dans `UNKNOWN` revenait à interroger le
    registre des comptes-titres au sujet d'une ligne qui n'y figure pas.

    L'écart est donc une soustraction, et sur la poche que la courbe affiche
    déjà : le coté (`nav` du scope `listed`), moins la crypto qui a son propre
    compte, moins ce que PEA et CTO portent. Ce qui reste ne tient à aucun
    compte — sur le jeu de démonstration, la ligne NASDAQ 100 en CFD.

    `null` — et non zéro — quand une brique manque : une enveloppe non
    démontrée n'autorise pas à affirmer qu'il ne reste rien.
  */
  const titres = titresValueAt(point);
  if (titres == null) return null;
  const listed = point.nav;
  const crypto = point.byAssetClass?.CRYPTO;
  if (!Number.isFinite(listed) || crypto == null || !Number.isFinite(crypto)) {
    return null;
  }
  return listed - crypto - titres;
}

/**
 * Valeur tracée pour un compte, à un jour donné.
 *
 * `TITRES` lit exclusivement le croisement (`titresValueAt`) ; `CRYPTO` lit
 * `byAssetClass.CRYPTO`, publié pour toute poche cotée (`listed` ou `brut`)
 * ; les autres comptes lisent `point.nav`, qui porte déjà la valeur du scope
 * demandé — c'est ce scope, choisi par `dailyNavScopeForAccount`, qui a fait
 * la requête `getDailyNav` correspondante.
 */
export function pocketValueAt(
  point: DailyNavPoint,
  account: EvolutionAccount,
  envelope?: "PEA" | "CTO" | null
): number | null {
  switch (account) {
    case "TITRES":
      return titresValueAt(point, envelope);
    case "CRYPTO":
      return point.byAssetClass?.CRYPTO ?? null;
    default:
      return point.nav;
  }
}

function emptyStockFields(total: number): Omit<
  EvolutionSeriesPoint,
  | "date"
  | "t"
  | "label"
  | "periodLabel"
  | "total"
  | "flows"
  | "chartValue"
  | "intervalType"
  | "status"
> {
  return {
    cash: 0,
    positions: total,
    realized: 0,
    unrealized: 0,
    income: 0,
    dividends: 0,
    coupons: 0,
    rents: 0,
    pos: 0,
    neg: 0,
    dPositions: 0,
    dCash: 0,
    dRealized: 0,
    dUnrealized: 0,
    dIncome: 0,
    dDividends: 0,
    dCoupons: 0,
    dRents: 0,
  };
}

/**
 * Flux du jour attribuables au compte — `0`, jamais fabriqué, dès que le
 * moteur ne publie pas la ventilation qui le justifierait.
 *
 * `flowsByAssetClass` ne connaît que les six classes `assetClass` : Titres
 * additionne ACTIONS + OBLIGATIONS, crypto/immobilier/cash lisent leur entrée
 * directe. Assurance-vie, alternatifs et épargne salariale n'ont pas de clé
 * dédiée — leurs flux ne sont pas reconstructibles, d'où `pnl = n/d` plutôt
 * qu'un P&L qui prétendrait neutraliser des versements qu'on n'a pas isolés.
 * Une enveloppe (PEA/CTO) n'a jamais de flux non plus : le journal ne sait
 * pas attribuer un versement ancien à une enveloppe.
 */
function flowsForAccount(
  point: DailyNavPoint,
  account: EvolutionAccount,
  envelope?: "PEA" | "CTO" | null
): number {
  if (envelope) return 0;
  const flows = point.flowsByAssetClass;
  switch (account) {
    case "TITRES":
      return (flows?.ACTIONS ?? 0) + (flows?.OBLIGATIONS ?? 0);
    case "CRYPTO":
      return flows?.CRYPTO ?? 0;
    case "IMMOBILIER":
      return flows?.IMMOBILIER ?? 0;
    case "CASH":
      return flows?.CASH ?? 0;
    case "ASSURANCE_VIE":
    case "ALTERNATIFS":
    case "EPARGNE_SALARIALE":
      return 0;
  }
}

/**
 * Le P&L de période n'est fiable que là où `flowsForAccount` reconstruit un
 * vrai flux. Sert au panneau à décider entre un P&L chiffré et `n/d`.
 */
export function pocketFlowsUnreliable(
  account: EvolutionAccount | null,
  envelope?: "PEA" | "CTO" | null
): boolean {
  if (envelope) return true;
  return (
    account === "ASSURANCE_VIE" ||
    account === "ALTERNATIFS" ||
    account === "EPARGNE_SALARIALE"
  );
}

/**
 * Série tracée pour un filtre de compte — les valeurs du moteur, sans
 * interpolation. Le type de trait (`stepAfter` / `linear`) est une décision
 * d'écran, pas une fabrication de points intermédiaires.
 */
export function toPocketEvolutionPoints(
  points: DailyNavPoint[],
  account: EvolutionAccount,
  envelope?: "PEA" | "CTO" | null
): EvolutionSeriesPoint[] {
  const out: EvolutionSeriesPoint[] = [];
  for (const p of points) {
    const total = pocketValueAt(p, account, envelope);
    if (total == null) continue;
    const at = endOfParisDay(p.day);
    const flows = flowsForAccount(p, account, envelope);
    out.push({
      date: at.toISOString(),
      t: at.getTime(),
      label: p.day,
      periodLabel: p.day,
      total,
      flows,
      chartValue: total,
      intervalType: "day",
      status: p.status === "EXACT" ? "EXACT" : "ESTIMATED",
      ...emptyStockFields(total),
    });
  }
  return out;
}

/** Points au format du graphique de valeur, pour les tests de marches. */
export function toPocketChartPoints(
  points: DailyNavPoint[],
  account: EvolutionAccount,
  envelope?: "PEA" | "CTO" | null
): Array<Pick<DailyNavChartPoint, "day" | "t" | "periodLabel" | "total">> {
  return toPocketEvolutionPoints(points, account, envelope).map((p) => ({
    day: p.label,
    t: p.t ?? 0,
    periodLabel: p.periodLabel,
    total: p.total,
  }));
}

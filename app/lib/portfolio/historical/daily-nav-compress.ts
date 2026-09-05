/**
 * Échantillonnage aval de la série `daily-nav`, à la frontière HTTP.
 *
 * Le moteur (`buildSeries`) et `getDailyNav` restent **denses** : un point par
 * jour civil, sans exception — c'est leur contrat, vérifié par les tests
 * golden de `get-daily-nav.test.ts`. Cette compression n'y touche pas ; elle
 * s'applique en aval, sur la réponse déjà construite, pour que « Tout » sur un
 * patrimoine à plateau (années sans écriture entre deux acquisitions) ne
 * traîne pas des milliers de points identiques jusqu'au client.
 *
 * Règle, volontairement sans seuil ni interpolation :
 *
 * > Toute suite de jours consécutifs dont **toutes** les grandeurs publiées
 * > sont identiques est comprimée en ne gardant que son premier et son dernier
 * > jour, plus un point par année civile traversée.
 *
 * « Toutes les grandeurs publiées » = tout le contenu de `DailyNavPoint`, pas
 * la seule valeur du scope demandé : brut, net, financier, listed, chaque
 * poche, le statut, les origines de prix, le P&L, le croisement
 * classe × enveloppe. Un jour où une poche hors scope bouge — ou où
 * `UNKNOWN` devient PEA — n'est jamais compressible, même si `nav` n'a
 * pas changé.
 *
 * Un jour porteur d'un flux externe non nul (`externalFlows`,
 * `transactionFlow`, `financierFlows`) n'est jamais comprimé : il reste seul,
 * frontière de plein droit entre deux paliers.
 *
 * Sur une tranche dense (cotations qui bougent chaque jour), deux jours
 * consécutifs ne sont presque jamais identiques : rien n'est retiré, le
 * contrat « un point par jour civil » y survit intact à l'écran.
 */

import type { DailyNavPoint } from "./get-daily-nav";

function sameOrigins(a: DailyNavPoint["priceOrigins"], b: DailyNavPoint["priceOrigins"]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** `true` si rien de ce que le point publie n'a changé entre `a` et `b`. */
function sameSnapshot(a: DailyNavPoint, b: DailyNavPoint): boolean {
  return (
    a.status === b.status &&
    a.nav === b.nav &&
    a.brut === b.brut &&
    a.net === b.net &&
    a.financier === b.financier &&
    a.listed === b.listed &&
    a.cash === b.cash &&
    a.immobilier === b.immobilier &&
    a.av === b.av &&
    a.alternatifs === b.alternatifs &&
    a.employeeSavings === b.employeeSavings &&
    a.passifs === b.passifs &&
    a.unrealizedPnl === b.unrealizedPnl &&
    a.realizedPnl === b.realizedPnl &&
    a.ledgerCashIncome === b.ledgerCashIncome &&
    sameOrigins(a.priceOrigins, b.priceOrigins) &&
    sameEnvelope(a.byAssetClassAndEnvelope, b.byAssetClassAndEnvelope)
  );
}

function sameEnvelope(
  a: DailyNavPoint["byAssetClassAndEnvelope"] | undefined,
  b: DailyNavPoint["byAssetClassAndEnvelope"] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const cls of ["ACTIONS", "OBLIGATIONS"] as const) {
    const ac = a[cls];
    const bc = b[cls];
    if (ac === bc) continue;
    if (!ac || !bc) return false;
    if (ac.PEA !== bc.PEA || ac.CTO !== bc.CTO || ac.UNKNOWN !== bc.UNKNOWN) {
      return false;
    }
  }
  return true;
}

/** `true` si un flux non nul, de quelque nature, est publié ce jour-là. */
function hasFlow(p: DailyNavPoint): boolean {
  return (
    p.externalFlows !== 0 || p.transactionFlow !== 0 || p.financierFlows !== 0
  );
}

/**
 * Comprime les suites de jours identiques d'une série `DailyNavPoint` dense.
 *
 * Ne modifie aucune valeur, ne fait aucune interpolation : elle retire des
 * points dont le rendu serait de toute façon superposé au précédent, en
 * gardant les deux extrémités de chaque palier et un repère par année civile
 * traversée pour que l'échelle de temps reste lisible.
 */
export function compressDailyNavPoints(points: DailyNavPoint[]): DailyNavPoint[] {
  const n = points.length;
  if (n <= 2) return points;

  const isBreak = new Array<boolean>(n).fill(false);
  isBreak[0] = true;
  isBreak[n - 1] = true;

  for (let i = 1; i < n; i++) {
    if (hasFlow(points[i]!)) isBreak[i] = true;
    if (!sameSnapshot(points[i]!, points[i - 1]!)) {
      // Les deux jours qui encadrent un changement encadrent l'acquisition ou
      // le mouvement lui-même : les perdre ferait apparaître le saut comme
      // rétroactif plutôt que daté.
      isBreak[i] = true;
      isBreak[i - 1] = true;
    }
  }

  const keep = new Set<number>();
  for (let i = 0; i < n; i++) if (isBreak[i]) keep.add(i);

  // Un point par année civile traversée à l'intérieur de chaque palier.
  let prevBreak = 0;
  for (let i = 1; i < n; i++) {
    if (!isBreak[i]) continue;
    let lastYear = points[prevBreak]!.day.slice(0, 4);
    for (let j = prevBreak + 1; j < i; j++) {
      const year = points[j]!.day.slice(0, 4);
      if (year !== lastYear) {
        keep.add(j);
        lastYear = year;
      }
    }
    prevBreak = i;
  }

  return [...keep].sort((a, b) => a - b).map((i) => points[i]!);
}

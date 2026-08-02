import type { ClassDailyPnl } from "./class-history";

/**
 * Performance d'une classe d'actifs sur une fenêtre, à partir du P&L journalier.
 *
 * La vignette du portefeuille traçait jusqu'ici la **valeur de marché** de la
 * classe. Ce n'est pas une courbe de performance : elle monte d'un cran le jour
 * d'un achat et retombe le jour d'une vente, sans qu'aucun cours n'ait bougé.
 * Un versement s'y lisait comme un gain.
 *
 * On trace donc le **P&L cumulé** : la somme des P&L journaliers, dont les flux
 * sont déjà neutralisés en amont (`buildClassDailyPnl` retranche les apports et
 * ajoute les revenus). La courbe part de zéro au premier jour de la fenêtre et
 * ne bouge que sous l'effet des cours. Son point d'arrivée est exactement le
 * gain ou la perte de la période — le chiffre affiché à côté d'elle.
 */

export type ClassPeriodPerformance = {
  /** P&L cumulé jour par jour, en devise de base. Commence à 0. */
  cumulative: number[];
  /** P&L de la période entière = dernier point de la courbe. */
  pnl: number;
  /**
   * Rendement de la période, en pourcentage du capital engagé.
   * `null` quand ce capital est nul ou négatif : diviser par lui produirait
   * un pourcentage sans signification plutôt qu'une information manquante.
   */
  pct: number | null;
};

/**
 * Capital engagé sur la fenêtre, dénominateur du rendement.
 *
 * C'est la valeur détenue au premier jour, **plus les apports nets** de la
 * période : une classe ouverte en cours de fenêtre part de zéro, et rapporter
 * son gain à zéro ne voudrait rien dire. Les flux ne sont pas transmis
 * séparément, mais ils se déduisent des deux séries — la valeur d'un jour vaut
 * celle de la veille, plus le flux, plus le P&L :
 *
 *     flux(t) = valeur(t) − valeur(t−1) − pnl(t)
 *
 * Un retrait (flux négatif) diminue d'autant le capital engagé, ce qui est
 * bien l'intention : on ne veut pas continuer à rapporter le gain à un capital
 * qu'on a retiré.
 */
function engagedCapital(values: number[], pnls: number[]): number {
  let capital = values[0] ?? 0;
  for (let i = 1; i < values.length; i += 1) {
    capital += (values[i] ?? 0) - (values[i - 1] ?? 0) - (pnls[i] ?? 0);
  }
  return capital;
}

/**
 * Séries de performance par classe sur la fenêtre demandée.
 *
 * Une classe absente de `valueByClass` un jour donné y valait zéro — la
 * construction amont n'inscrit que les valeurs non nulles. L'absence de cours,
 * elle, est signalée à part (`incompleteClasses`) et n'a pas à être devinée
 * ici : le jour porte alors la dernière valeur connue, reportée en amont.
 */
export function buildClassPeriodSeries(
  points: ClassDailyPnl[]
): Map<string, ClassPeriodPerformance> {
  const out = new Map<string, ClassPeriodPerformance>();
  if (points.length < 2) return out;

  const classes = new Set<string>();
  for (const p of points) {
    for (const cls of Object.keys(p.valueByClass ?? {})) classes.add(cls);
    for (const cls of Object.keys(p.pnlByClass ?? {})) classes.add(cls);
  }

  for (const cls of classes) {
    const cumulative: number[] = [];
    const values: number[] = [];
    const pnls: number[] = [];
    let running = 0;
    let moved = false;

    for (const p of points) {
      const pnl = p.pnlByClass?.[cls];
      const daily = typeof pnl === "number" && Number.isFinite(pnl) ? pnl : 0;
      running += daily;
      cumulative.push(running);
      pnls.push(daily);

      const value = p.valueByClass?.[cls];
      const held = typeof value === "number" && Number.isFinite(value) ? value : 0;
      values.push(held);
      if (held !== 0 || daily !== 0) moved = true;
    }

    // Classe jamais détenue et sans P&L sur la fenêtre : rien à tracer.
    if (!moved) continue;

    const pnlTotal = running;
    const capital = engagedCapital(values, pnls);
    const pct = capital > 0 ? (pnlTotal / capital) * 100 : null;

    out.set(cls, { cumulative, pnl: pnlTotal, pct });
  }

  return out;
}

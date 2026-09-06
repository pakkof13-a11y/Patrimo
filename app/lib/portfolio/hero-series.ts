/**
 * Série lisible de la carte de tête — un point de courbe enrichi de ce qu'il
 * faut pour le décrire à l'écran.
 *
 * `kpiSeries` rend des nombres, ce qui suffit à tracer mais pas à répondre au
 * survol : « combien, quel jour, de combien ça a bougé, et est-ce une valeur
 * observée ou reportée ». Ce module recompose ces réponses à partir des champs
 * que le moteur publie déjà, sans en calculer de nouveaux.
 *
 * Rien n'est interpolé ici. Une journée absente de l'historique reste absente :
 * la courbe la franchit d'un segment, et l'aimantation du survol tombe sur le
 * point réel le plus proche. C'est la règle des paliers — un bien immobilier
 * revalorisé deux fois par an doit garder ses marches, pas recevoir 180 valeurs
 * quotidiennes inventées entre deux estimations.
 */

import type { HistoryPoint } from "@/app/lib/types/ui";

/** Lecture demandée par les cartes de tête — défaut produit : Financier. */
export type HeroMode = "financier" | "net" | "brut";

export type HeroSeriesPoint = {
  /** Rang dans la série tracée, et dans l'historique dont elle vient. */
  index: number;
  /** Horodatage du point (clôture de la journée civile parisienne). */
  date: string;
  /** Montant selon le mode — c'est lui que le chiffre de tête reprend. */
  value: number;
  /**
   * Décomposition actifs / passifs, renseignée quand l'historique la porte.
   *
   * Utile en mode net seulement : c'est là que la question « net de quoi ? »
   * se pose. Absente plutôt que reconstruite — soustraire soi-même rouvrirait
   * un périmètre que le moteur a déjà tranché.
   */
  grossAssets?: number;
  liabilities?: number;
  /**
   * La valeur du jour a été reportée, non observée.
   *
   * Week-end, jour férié, actif illiquide : le moteur reconduit la dernière
   * valorisation connue et le signale par `status: "ESTIMATED"`. La courbe doit
   * le montrer plus discrètement, et l'info-bulle le dire — sans quoi une
   * valeur reconduite se lit comme une mesure du jour.
   */
  carried: boolean;
  /** Date de la dernière valorisation réellement observée, si `carried`. */
  lastObservedDate?: string;
  /**
   * Pastille tx (journal coté) — distincte de Marché/Flux.
   *
   * Un achat immo gonfle `externalFlows` sans y figurer. Absent si nul
   * ou inconnu : on ne pose pas de pastille inventée.
   */
  externalFlow?: number;
  /**
   * Flux du **périmètre** (D3) : Financier = `financierFlows` ; Brut =
   * `externalFlows` ; Net = `externalFlows − Δpassifs`. Absent si le
   * champ n'est pas publié — jamais un 0 inventé pour l'afficher.
   */
  flow?: number;
  /**
   * Marché du jour = ΔNAV − flux, **même identité** que `heroAttribution`
   * / `dailyNavDeltas`. Absent si le flux est inconnu (on ne fabrique pas
   * un marché en supposant flux = 0).
   */
  market?: number;
  /**
   * Écart NAV avec le point précédent **disponible**, pas avec le début
   * de série. L'info-bulle D3 ne l'affiche plus (Marché/Flux à la place) ;
   * il reste pour les tests de voisinage.
   */
  deltaAbs?: number;
  /** Même écart en pourcentage — absent aussi quand la veille valait zéro. */
  deltaPct?: number;
};

function finite(v: number | undefined | null): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Flux du jour selon le périmètre — **lecture** des champs déjà publiés,
 * même convention que `heroAttribution` / `fluxOfDay`. Pas une 2ᵉ formule.
 *
 * L'ancre (pas de veille) n'a pas de flux de fenêtre : `undefined`, pour
 * que l'info-bulle masque Flux plutôt que d'écrire « Flux 0 € ».
 */
function scopeFlowAt(
  point: HistoryPoint,
  previous: HistoryPoint | undefined,
  mode: HeroMode
): number | undefined {
  if (!previous) return undefined;
  if (mode === "financier") return finite(point.financierFlowsBase);
  if (mode === "brut") return finite(point.externalFlowsBase);
  const ext = finite(point.externalFlowsBase);
  const liab = finite(point.liabilitiesBase);
  const prevLiab = finite(previous.liabilitiesBase);
  if (ext === undefined || liab === undefined || prevLiab === undefined) {
    return undefined;
  }
  return ext - (liab - prevLiab);
}

/**
 * Assemble la série affichable à partir de l'historique et des valeurs tracées.
 *
 * `values` vient de `kpiSeries`, qui rend un tableau de même longueur et de
 * même ordre que `history` — ou rien du tout si une grandeur manque. Les deux
 * sont donc alignés rang par rang. La garde de longueur n'est pas là par excès
 * de prudence : deux tableaux désalignés afficheraient la date d'un jour
 * au-dessus du montant d'un autre, et rien à l'écran ne le trahirait.
 */
export function buildHeroSeries(
  history: HistoryPoint[],
  values: number[] | undefined,
  mode: HeroMode
): HeroSeriesPoint[] {
  if (!values || values.length !== history.length || values.length === 0) {
    return [];
  }

  let lastObserved: string | undefined;

  return history.map((p, index) => {
    const value = values[index]!;
    const carried = p.status === "ESTIMATED" || p.estimated === true;
    if (!carried) lastObserved = p.date;

    const previous = index > 0 ? values[index - 1]! : undefined;
    const deltaAbs = previous === undefined ? undefined : value - previous;
    const deltaPct =
      previous === undefined || previous === 0
        ? undefined
        : ((value - previous) / Math.abs(previous)) * 100;

    /*
      Pastilles txs = journal coté, pas les flux d'attribution.
      Un achat immo reste dans Marché/Flux (`externalFlows`) sans pastille
      sur la courbe Financier.
    */
    const tx = finite(p.transactionFlowBase);
    const prevPoint = index > 0 ? history[index - 1] : undefined;
    const scopeFlow = scopeFlowAt(p, prevPoint, mode);

    const point: HeroSeriesPoint = {
      index,
      date: p.date,
      value,
      carried,
    };

    if (mode === "net") {
      const gross = finite(p.grossAssetsBase);
      const liabilities = finite(p.liabilitiesBase);
      if (gross !== undefined) point.grossAssets = gross;
      if (liabilities !== undefined) point.liabilities = liabilities;
    }
    // `lastObserved` porte ici la dernière observation **antérieure ou égale**,
    // donc celle dont la valeur a été reconduite.
    if (carried && lastObserved !== undefined) {
      point.lastObservedDate = lastObserved;
    }
    if (tx !== undefined && tx !== 0) point.externalFlow = tx;
    if (scopeFlow !== undefined) {
      point.flow = scopeFlow;
      if (deltaAbs !== undefined && Number.isFinite(deltaAbs)) {
        point.market = deltaAbs - scopeFlow;
      }
    }
    if (deltaAbs !== undefined && Number.isFinite(deltaAbs)) {
      point.deltaAbs = deltaAbs;
    }
    if (deltaPct !== undefined && Number.isFinite(deltaPct)) {
      point.deltaPct = deltaPct;
    }
    return point;
  });
}

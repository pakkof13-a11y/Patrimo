/**
 * D'où vient la variation de la période : du marché, ou de l'argent apporté.
 *
 * C'est la question qu'une courbe seule ne sait pas trancher. Un patrimoine
 * qui passe de 900 k€ à 1,9 M€ n'a pas forcément gagné un million : il a peut-
 * être acheté un appartement. Tant que l'écran ne distingue pas les deux, la
 * marche d'un achat se lit comme une performance.
 *
 * ## La décomposition
 *
 * ```
 * variation = marché + flux
 * flux      = Σ des mouvements de capitaux de la fenêtre
 * marché    = variation − flux
 * ```
 *
 * Le marché est obtenu **par différence**, et ce n'est pas un raccourci : c'est
 * ce qui garantit l'identité. Le moteur publie bien une performance par jour
 * (`investmentPerformanceBase`), mais la sommer sur les points affichés serait
 * faux — la série est échantillonnée à 900 points pour l'affichage, et les
 * journées retirées emporteraient leur performance avec elles. Les journées à
 * flux, elles, sont toutes conservées par construction (`downsampleSeries`
 * garde tout point dont `externalFlows` n'est pas nul), si bien que la somme
 * des flux reste exacte quelle que soit la longueur de l'historique.
 *
 * ## Ce que le moteur classe déjà, et qu'on ne refait pas ici
 *
 * - **Entrée d'un actif** — achat de titres, acquisition d'un bien, entrée
 *   d'une ligne alternative : flux, à son coût. Sans quoi acquérir 2 M€ d'art
 *   se lirait comme une plus-value du même montant le jour de l'achat.
 * - **Revalorisation ultérieure** d'un actif illiquide (SCPI, appartement) :
 *   aucun flux, donc marché. C'est bien un changement de juste valeur.
 * - **Le jour de l'acquisition**, une valorisation datée du même jour est
 *   ignorée au profit du prix payé : l'entrée vaut son notionnel, et la
 *   performance du jour est nulle.
 *
 * ## Le cas des passifs, en mode net
 *
 * `variation = marché + flux` est une identité sur le **brut**. En net, la
 * variation intègre aussi le mouvement des dettes, qui n'est ni du marché ni
 * un apport d'actif :
 *
 * ```
 * Δnet = Δbrut − Δpassifs = (marché + flux_actifs) − Δpassifs
 * ```
 *
 * Le mouvement des dettes rejoint donc les flux, avec son signe inversé — un
 * emprunt débloqué fait entrer du cash *et* de la dette, les deux s'annulent,
 * et le patrimoine net ne bouge pas ; un remboursement de capital convertit du
 * cash en fonds propres, sans performance non plus. Conséquence remarquable et
 * voulue : **le marché est le même dans les deux modes**, seul le flux diffère.
 */

import type { HistoryPoint } from "@/app/lib/types/ui";
import type { HeroMode } from "@/app/lib/portfolio/hero-series";

export type HeroAttribution = {
  /** Variation totale de la fenêtre — identique à celle affichée au-dessus. */
  variation: number;
  /** Ce que la valeur des actifs a produit, mouvements de capitaux retirés. */
  market: number;
  /** Capitaux entrés ou sortis sur la fenêtre. */
  flow: number;
};

function finite(v: number | undefined | null): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Valeur du point selon le mode, ou `undefined` si l'historique ne la porte pas. */
function valueAt(p: HistoryPoint, mode: HeroMode): number | undefined {
  return finite(mode === "net" ? p.netWorthBase : p.grossAssetsBase);
}

/**
 * Décompose la variation d'une fenêtre, ou rend `null`.
 *
 * `null` — et jamais des zéros — quand l'historique ne porte pas les flux : la
 * série peut venir d'une réponse plus ancienne, ou d'un cache. Afficher
 * « Flux 0 € » signifierait « aucun capital n'est entré », ce qui est une
 * affirmation, alors qu'on ne sait simplement pas. L'appelant masque alors les
 * deux pastilles et n'affiche que la variation.
 *
 * `windowed` est la fenêtre telle que `windowForRange` la rend : son premier
 * point est l'**ancre**, le dernier relevé connu avant la période. Il donne la
 * valeur de départ, mais ses propres flux appartiennent à la veille de la
 * fenêtre — ils sont donc exclus de la somme, qui court du rang 1 au dernier.
 */
export function heroAttribution(
  windowed: HistoryPoint[],
  mode: HeroMode
): HeroAttribution | null {
  if (windowed.length < 2) return null;

  const firstPoint = windowed[0]!;
  const lastPoint = windowed[windowed.length - 1]!;

  const start = valueAt(firstPoint, mode);
  const end = valueAt(lastPoint, mode);
  if (start === undefined || end === undefined) return null;

  let flow = 0;
  for (let i = 1; i < windowed.length; i++) {
    const f = finite(windowed[i]!.externalFlowsBase);
    // Un seul point sans flux rend la somme incomplète : on préfère ne rien
    // dire plutôt que d'annoncer un total amputé d'une acquisition.
    if (f === undefined) return null;
    flow += f;
  }

  if (mode === "net") {
    const liabStart = finite(firstPoint.liabilitiesBase);
    const liabEnd = finite(lastPoint.liabilitiesBase);
    if (liabStart === undefined || liabEnd === undefined) return null;
    flow -= liabEnd - liabStart;
  }

  const variation = end - start;
  return { variation, market: variation - flow, flow };
}

/**
 * Seuil au-delà duquel un mouvement de capitaux mérite un repère sur la courbe.
 *
 * Cinq mille euros : assez haut pour ignorer un virement d'épargne mensuel sur
 * dix ans d'historique, assez bas pour ne manquer aucune acquisition. Le repère
 * signale une marche que la courbe montre sans l'expliquer — en dessous, il n'y
 * a pas de marche à expliquer.
 */
export const HERO_EVENT_FLOW_THRESHOLD = 5_000;

/**
 * Nombre de repères affichés simultanément.
 *
 * Dix ans d'historique portent des centaines de journées à flux ; les poser
 * toutes rendrait la courbe illisible et n'expliquerait plus rien. Les cinq
 * plus gros mouvements suffisent à raconter la fenêtre ; les autres restent
 * atteignables au survol du jour, où l'info-bulle les nomme.
 */
export const HERO_MAX_EVENT_MARKERS = 5;

export type HeroEventMarker = {
  /** Rang dans la série tracée. */
  index: number;
  /** Montant du mouvement, signé. */
  amount: number;
};

/**
 * Les mouvements les plus marquants de la fenêtre, au plus cinq.
 *
 * Le tri porte sur la valeur absolue : une sortie de 200 k€ explique la courbe
 * autant qu'une entrée du même montant. L'ordre rendu est celui du temps, pour
 * que les repères se posent de gauche à droite.
 */
export function heroEventMarkers(
  flows: Array<{ index: number; amount: number | undefined }>,
  threshold = HERO_EVENT_FLOW_THRESHOLD,
  max = HERO_MAX_EVENT_MARKERS
): HeroEventMarker[] {
  const candidates: HeroEventMarker[] = [];
  for (const f of flows) {
    if (f.amount === undefined || !Number.isFinite(f.amount)) continue;
    if (Math.abs(f.amount) < threshold) continue;
    candidates.push({ index: f.index, amount: f.amount });
  }
  return candidates
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, max)
    .sort((a, b) => a.index - b.index);
}

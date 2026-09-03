/**
 * Périodes de la carte de tête.
 *
 * Sous-ensemble des plages du tableau de bord (`EvolutionRange`), et non un
 * second jeu : le fenêtrage, lui, reste celui de `windowForRange`. Deux
 * implémentations de « ce que couvre 1 mois » auraient fini par diverger d'un
 * jour, et l'écart se serait vu entre la carte et la courbe d'évolution sans
 * que rien ne l'explique.
 *
 * La carte n'expose ni 7J ni 6M — six chips tiennent dans la carte, huit la
 * feraient déborder — mais rien n'interdit de les rouvrir : ce sont les mêmes
 * valeurs côté calcul.
 *
 * ## Deux sélecteurs, volontairement
 *
 * La carte de tête et le bloc « Évolution + indicateurs » ne partagent **pas**
 * leur période. Unifier les deux dans `DashboardTab` casserait la lecture :
 *
 * - le hero répond à « d'où vient le patrimoine » (1M · 3M · YTD · 1A · 5A ·
 *   Max, six chips dans la carte, retenus sous `HERO_RANGE_KEY`) ;
 * - l'évolution et les KPI répondent à « comment il s'est comporté sur la
 *   période étudiée » (7J…Tout, `evolutionPrefs.v5`, un seul état soulevé
 *   dans `DashboardTab`).
 *
 * Les fenêtres, elles, s'appuient sur le même `windowForRange` et le même
 * `heroWindowReference` : deux questions, une horloge. Si un jour les
 * sélecteurs devaient se suivre, c'est ici et dans `dashboard-tab.tsx` que
 * la période remonterait, pas dans deux états séparés.
 */

import type { EvolutionRange } from "@/app/lib/portfolio/evolution-aggregate";
import type { HistoryPoint } from "@/app/lib/types/ui";

/** Les six périodes proposées, dans l'ordre d'affichage. */
export const HERO_RANGES = ["1m", "3m", "ytd", "1y", "5y", "all"] as const;

export type HeroRange = (typeof HERO_RANGES)[number];

/** Toute période de la carte est une période du tableau de bord. */
const _rangeIsEvolutionRange: readonly EvolutionRange[] = HERO_RANGES;
void _rangeIsEvolutionRange;

export const HERO_RANGE_LABEL: Record<HeroRange, string> = {
  "1m": "1M",
  "3m": "3M",
  ytd: "YTD",
  "1y": "1A",
  "5y": "5A",
  all: "Max",
};

export function isHeroRange(v: unknown): v is HeroRange {
  return (
    typeof v === "string" && (HERO_RANGES as readonly string[]).includes(v)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Période retenue à l'ouverture : un an, ou tout l'historique s'il est plus
 * court.
 *
 * Proposer « 1A » sur huit mois de données afficherait une fenêtre qui promet
 * plus que ce qu'elle contient — le libellé annoncerait un an là où la courbe
 * n'en couvre que les deux tiers. « Max » dit alors la vérité, et la carte
 * montre tout ce qu'elle a.
 */
export function defaultHeroRange(points: HistoryPoint[]): HeroRange {
  if (points.length < 2) return "all";
  const first = Date.parse(points[0]!.date);
  const last = Date.parse(points[points.length - 1]!.date);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return "all";
  return last - first >= 365 * DAY_MS ? "1y" : "all";
}

/**
 * Instant de référence du fenêtrage : la **dernière valorisation**, pas
 * l'horloge.
 *
 * Un historique qui s'arrête il y a trois jours donnerait, mesuré depuis
 * maintenant, une fenêtre « 1 mois » ne contenant que vingt-sept jours de
 * données. Depuis le dernier point, elle en contient bien trente.
 *
 * C'est aussi ce qui rend YTD juste : au 3 septembre, la fenêtre part du
 * 1er janvier de l'année de la dernière valorisation. Sur des données arrêtées
 * en décembre dernier, partir de l'année courante rendrait une fenêtre vide.
 */
export function heroWindowReference(points: HistoryPoint[]): Date {
  const last = points[points.length - 1];
  if (!last) return new Date();
  const t = Date.parse(last.date);
  return Number.isFinite(t) ? new Date(t) : new Date();
}

export type HeroWindowChange = {
  /** Variation en montant sur la fenêtre. */
  abs: number;
  /**
   * Variation en pourcentage, ou `null` quand la valeur de départ est nulle.
   *
   * Diverge volontairement de `seriesChangePct`, qui prend pour base la
   * première valeur **non nulle** de la série. Cette règle-là sert le bandeau
   * d'indicateurs, où un portefeuille qui démarre à zéro rendrait sinon toute
   * variation incalculable. Ici la question est autre : « de combien de pour
   * cent le patrimoine a-t-il bougé sur cette fenêtre ». Partir de zéro n'a
   * pas de réponse en pourcentage — aucune, pas une grande — et l'écran doit
   * le dire plutôt que de chercher un autre dénominateur.
   */
  pct: number | null;
};

/**
 * Variation entre le premier et le dernier point de la fenêtre.
 *
 * Le premier point est celui que `windowForRange` conserve en tête : le dernier
 * relevé connu **avant** la période. C'est bien la valeur au début de la
 * fenêtre, et non la première mesure qu'elle contient.
 */
export function heroWindowChange(values: number[]): HeroWindowChange | null {
  if (values.length < 2) return null;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const abs = last - first;
  return {
    abs,
    pct: first === 0 ? null : (abs / Math.abs(first)) * 100,
  };
}

/**
 * Ce que la variation couvre, dit en toutes lettres.
 *
 * Les périodes glissantes s'annoncent par leur durée (« sur 1 an »), celles qui
 * partent d'une date fixe par cette date (« depuis le 1er janv. »). `Max`
 * nomme le mois du premier point : « depuis mars 2021 » situe l'historique
 * mieux que « depuis le début », qui ne dit rien de sa profondeur.
 */
export function heroRangeSubtitle(
  range: HeroRange,
  windowStartDate: string | undefined
): string {
  switch (range) {
    case "1m":
      return "sur 1 mois";
    case "3m":
      return "sur 3 mois";
    case "1y":
      return "sur 1 an";
    case "5y":
      return "sur 5 ans";
    /*
      L'année n'est pas répétée ici : elle figure déjà dans « valo au … », sur
      la ligne voisine. La redire ferait deux millésimes à trois centimètres
      l'un de l'autre pour une seule information.
    */
    case "ytd":
      return "depuis le 1er janv.";
    case "all": {
      if (!windowStartDate) return "depuis l'origine";
      const t = Date.parse(windowStartDate);
      if (!Number.isFinite(t)) return "depuis l'origine";
      const moisAnnee = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        month: "long",
        year: "numeric",
      }).format(new Date(t));
      return `depuis ${moisAnnee}`;
    }
  }
}

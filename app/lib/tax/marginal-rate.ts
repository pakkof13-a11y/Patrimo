/**
 * Tranche marginale d'imposition du foyer — source de vérité unique.
 *
 * ## À qui appartient cette valeur
 *
 * La TMI est une propriété du **foyer fiscal**, pas d'un bien ni d'un module.
 * Elle découle des revenus du foyer et de son nombre de parts : un
 * contribuable a une tranche, appliquée à l'ensemble de ses revenus fonciers
 * agrégés — jamais une tranche par appartement.
 *
 * Elle vit donc sur `User`, à côté de `taxHousehold`, qui relève exactement du
 * même raisonnement et sert de précédent dans ce dépôt.
 *
 * ## Ce qu'Aurea ne fait pas
 *
 * Aurea ne **calcule** pas la TMI : il ne connaît ni les salaires, ni les
 * pensions, ni la composition du foyer. C'est une donnée que l'utilisateur
 * déclare. Tout écran qui s'en sert doit le dire.
 *
 * ## Absence de valeur
 *
 * `null` est un état représentable et distinct de « 30 % » : il signifie que
 * l'utilisateur n'a rien déclaré. Les moteurs ont besoin d'un taux pour
 * produire un arbitrage de régime locatif, donc un défaut métier existe — mais
 * il est **signalé** via `MarginalRateSource` plutôt que substitué en silence.
 */

/**
 * Tranches du barème de l'impôt sur le revenu.
 *
 * Ce sont les seules valeurs qu'un foyer peut porter : le barème est un
 * escalier, pas un curseur continu.
 */
export const MARGINAL_RATE_OPTIONS = [0, 11, 30, 41, 45] as const;

export type MarginalRatePct = (typeof MARGINAL_RATE_OPTIONS)[number];

/**
 * Défaut appliqué quand rien n'est déclaré.
 *
 * 30 % était déjà le défaut de `/api/real-estate/tax` avant ce chantier : le
 * conserver évite de changer le résultat des calculs existants pour les
 * utilisateurs qui n'ont jamais renseigné leur tranche. Ce qui change, c'est
 * qu'on sait désormais qu'il s'agit d'un défaut.
 */
export const DEFAULT_MARGINAL_RATE_PCT = 30;

export function isMarginalRatePct(value: unknown): value is MarginalRatePct {
  return (
    typeof value === "number" &&
    (MARGINAL_RATE_OPTIONS as readonly number[]).includes(value)
  );
}

/** D'où vient le taux réellement appliqué — jamais deviné par l'appelant. */
export type MarginalRateSource =
  /** Déclaré par l'utilisateur sur son profil. */
  | "USER"
  /** Fourni explicitement dans la requête, pour une simulation ponctuelle. */
  | "QUERY"
  /** Rien de déclaré : `DEFAULT_MARGINAL_RATE_PCT` s'applique. */
  | "DEFAULT";

export type ResolvedMarginalRate = {
  pct: number;
  source: MarginalRateSource;
};

/**
 * Résout le taux applicable.
 *
 * L'ordre est délibéré. Une valeur passée en requête l'emporte sur le profil
 * parce qu'elle sert aux simulations : le sélecteur de l'onglet Immobilier
 * doit pouvoir répondre à « et si j'étais à 41 % ? » sans écrire dans le
 * profil. Le profil l'emporte sur le défaut, faute de quoi la déclaration de
 * l'utilisateur ne servirait à rien.
 *
 * Une valeur de requête hors barème est ignorée plutôt que corrigée : accepter
 * 33 % produirait un impôt qu'aucun barème ne prévoit.
 */
export function resolveMarginalRate(input: {
  /** Valeur de requête, si l'appelant en a fourni une. */
  query?: number | null;
  /** Valeur déclarée sur le profil utilisateur. */
  user?: number | null;
}): ResolvedMarginalRate {
  if (isMarginalRatePct(input.query)) {
    return { pct: input.query, source: "QUERY" };
  }
  if (isMarginalRatePct(input.user)) {
    return { pct: input.user, source: "USER" };
  }
  return { pct: DEFAULT_MARGINAL_RATE_PCT, source: "DEFAULT" };
}

/** Libellé court — « 30 % ». */
export function marginalRateLabel(pct: number): string {
  return `${pct} %`;
}

/**
 * Phrase à afficher sous un montant calculé avec ce taux.
 *
 * Le texte change selon la source parce que la confiance à accorder au chiffre
 * change aussi : un taux déclaré engage l'utilisateur, un défaut n'engage
 * personne.
 */
export function marginalRateNotice(resolved: ResolvedMarginalRate): string {
  switch (resolved.source) {
    case "USER":
      return `Calculé avec votre tranche marginale de ${marginalRateLabel(resolved.pct)}.`;
    case "QUERY":
      return `Simulation à ${marginalRateLabel(resolved.pct)}.`;
    case "DEFAULT":
    default:
      return `Calculé avec une tranche par défaut de ${marginalRateLabel(
        resolved.pct
      )} : renseignez la vôtre pour un résultat qui vous corresponde.`;
  }
}

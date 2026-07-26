/**
 * Antériorité fiscale d'un contrat d'assurance-vie.
 *
 * La fiscalité d'un rachat dépend d'abord de l'âge du contrat : au-delà de huit
 * ans s'ouvrent l'abattement annuel sur les gains (4 600 € pour une personne
 * seule, 9 200 € pour un couple) et le taux réduit de 7,5 % sur la part des
 * versements sous 150 000 €. C'est la seule information que le journal de
 * transactions ne porte pas — d'où la survie du contrat comme entité.
 *
 * Ce module se limite volontairement à l'**antériorité**. Le calcul complet
 * d'imposition d'un rachat exige des données que l'application ne collecte pas
 * encore (répartition des versements avant / après le 27 septembre 2017,
 * encours total tous contrats pour le seuil de 150 000 €, situation maritale) et
 * ne porte que sur la quote-part de gains contenue dans le rachat, jamais sur
 * le rachat entier. Afficher une estimation à partir de données absentes
 * donnerait un chiffre faux sur un sujet où l'utilisateur ne peut pas vérifier.
 */

/** Seuil d'antériorité ouvrant abattement et taux réduit. */
export const ANTERIORITY_YEARS = 8;

/** Abattement annuel sur les gains, personne seule. */
export const ANNUAL_ALLOWANCE_SINGLE_EUR = 4_600;
/** Abattement annuel sur les gains, couple soumis à imposition commune. */
export const ANNUAL_ALLOWANCE_COUPLE_EUR = 9_200;

/** Prélèvements sociaux sur les gains. */
export const SOCIAL_CHARGES_RATE = 0.172;

/**
 * Nombre de mois pleins entre deux dates.
 *
 * Compté en mois calendaires plutôt qu'en jours divisés : l'antériorité
 * s'apprécie de date à date, et un contrat ouvert le 31 janvier a huit ans le
 * 31 janvier, sans qu'une année bissextile ne décale le seuil d'un jour.
 */
export function fullMonthsBetween(from: Date, to: Date): number {
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());
  // Le mois n'est révolu que si le jour est atteint.
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}

export type ContractAge = {
  /** Mois pleins écoulés depuis l'ouverture. */
  months: number;
  years: number;
  /** L'antériorité de huit ans est-elle acquise ? */
  hasAnteriority: boolean;
  /** Mois restants avant les huit ans — 0 dès qu'ils sont acquis. */
  monthsToAnteriority: number;
};

/**
 * Âge d'un contrat, et position par rapport au seuil des huit ans.
 *
 * Une date d'ouverture future rend un âge nul plutôt qu'un négatif : elle
 * relève d'une saisie erronée, et propager un nombre négatif ferait apparaître
 * l'antériorité comme « acquise dans -3 mois » dans l'interface.
 */
export function contractAge(openDate: Date, now: Date = new Date()): ContractAge {
  const months = Math.max(0, fullMonthsBetween(openDate, now));
  const threshold = ANTERIORITY_YEARS * 12;
  return {
    months,
    years: Math.floor(months / 12),
    hasAnteriority: months >= threshold,
    monthsToAnteriority: Math.max(0, threshold - months),
  };
}

/**
 * Libellé court d'antériorité, pour l'en-tête d'un contrat.
 *
 * Rend une chaîne vide sur une date illisible : mieux vaut n'afficher aucune
 * mention fiscale qu'une mention fausse.
 */
export function contractAgeLabel(
  openDate: string | Date,
  now: Date = new Date()
): string {
  const date = openDate instanceof Date ? openDate : new Date(openDate);
  if (Number.isNaN(date.getTime())) return "";

  const age = contractAge(date, now);
  if (age.hasAnteriority) {
    return `antériorité acquise (${age.years} ans)`;
  }
  const m = age.monthsToAnteriority;
  if (m <= 1) return "antériorité dans moins d'un mois";
  if (m < 12) return `antériorité dans ${m} mois`;
  const years = Math.floor(m / 12);
  const rest = m % 12;
  return rest === 0
    ? `antériorité dans ${years} an${years > 1 ? "s" : ""}`
    : `antériorité dans ${years} an${years > 1 ? "s" : ""} et ${rest} mois`;
}

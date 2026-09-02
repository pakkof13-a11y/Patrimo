/**
 * Données fiscales d'un contrat d'assurance-vie (antériorité + collecte).
 *
 * La fiscalité d'un rachat dépend d'abord de l'âge du contrat : au-delà de huit
 * ans s'ouvrent l'abattement annuel sur les gains (4 600 € pour une personne
 * seule, 9 200 € pour un couple) et le taux réduit de 7,5 % sur la part des
 * versements sous 150 000 €. C'est la seule information que le journal de
 * transactions ne porte pas — d'où la survie du contrat comme entité.
 *
 * ## Étape 1 — collecte
 *
 * Ce module stocke et contrôle les **entrées** du calcul de rachat :
 * répartition des versements avant / après le 27 septembre 2017, situation
 * fiscale du foyer, encours total tous contrats (somme, jamais un champ saisi).
 *
 * ## Étape 2 — imposition
 *
 * Le moteur pur vit dans `redemption-tax.ts` (`computeRedemptionTax`) : il
 * consomme ces entrées + la quote-part de gains du rachat, sans Prisma.
 */

/** Seuil d'antériorité ouvrant abattement et taux réduit. */
export const ANTERIORITY_YEARS = 8;

/** Abattement annuel sur les gains, personne seule. */
export const ANNUAL_ALLOWANCE_SINGLE_EUR = 4_600;
/** Abattement annuel sur les gains, couple soumis à imposition commune. */
export const ANNUAL_ALLOWANCE_COUPLE_EUR = 9_200;

/**
 * Date pivot de la réforme PFU : les versements **à compter de** ce jour
 * relèvent du régime post-réforme (12,8 % hors abattement / seuil).
 * Les versements strictement antérieurs relèvent du régime antérieur (7,5 %).
 */
export const PREMIUMS_PFU_CUTOFF_ISO = "2017-09-27";

/** Seuil d'encours global (tous contrats) pour le taux réduit de 7,5 %. */
export const PFU_OUTSTANDING_THRESHOLD_EUR = 150_000;

/** Prélèvements sociaux sur les gains. */
export const SOCIAL_CHARGES_RATE = 0.172;

/** Situation fiscale du foyer — une seule valeur par utilisateur. */
export const TAX_HOUSEHOLDS = ["SINGLE", "COUPLE"] as const;
export type TaxHousehold = (typeof TAX_HOUSEHOLDS)[number];

export function isTaxHousehold(value: unknown): value is TaxHousehold {
  return value === "SINGLE" || value === "COUPLE";
}

/** Abattement annuel applicable selon la situation du foyer. */
export function annualAllowanceEur(household: TaxHousehold): number {
  return household === "COUPLE"
    ? ANNUAL_ALLOWANCE_COUPLE_EUR
    : ANNUAL_ALLOWANCE_SINGLE_EUR;
}

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

// ─── Répartition des versements (avant / après 27/09/2017) ───────────────────

const MONEY_EPS = 1e-6;

function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatMoney(n: number): string {
  // Évite les artefacts binaires (0.1+0.2) tout en restant lisible en EUR.
  const fixed = n.toFixed(8).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/**
 * Répartition des primes d'un contrat autour de la date pivot PFU.
 *
 * `totalPremiumsEur` est optionnel : s'il est fourni, il doit égaler
 * avant + après (critère d'acceptation « somme = total versé »). Sinon le
 * total se déduit de la somme des deux parts.
 */
export type PremiumsSplitInput = {
  premiumsBefore2017Eur: string | number;
  premiumsAfter2017Eur: string | number;
  /** Total versé déclaré — doit coïncider avec avant + après s'il est fourni. */
  totalPremiumsEur?: string | number | null;
};

export type PremiumsSplit = {
  ok: boolean;
  premiumsBefore2017Eur: string;
  premiumsAfter2017Eur: string;
  /** Toujours avant + après quand ok ; sinon "0". */
  totalPremiumsEur: string;
  /** Part avant seuil dans [0, 1] ; 0 si total nul. */
  beforeShare: number;
  /** Part après seuil dans [0, 1] ; 0 si total nul. */
  afterShare: number;
  error?: string;
};

/**
 * Valide et normalise la répartition des versements d'un contrat.
 *
 * Garanties quand `ok` :
 * - montants ≥ 0 et finis ;
 * - `totalPremiumsEur` = avant + après ;
 * - si un total déclaré est fourni, il coïncide (tolérance monétaire).
 *
 * C'est la seule source de vérité pour « quelle part des versements est
 * antérieure / postérieure au 27/09/2017 » — aucun recalcul manuel.
 */
export function checkPremiumsSplit(input: PremiumsSplitInput): PremiumsSplit {
  const before = parseMoney(input.premiumsBefore2017Eur);
  const after = parseMoney(input.premiumsAfter2017Eur);
  const declared =
    input.totalPremiumsEur === undefined || input.totalPremiumsEur === null
      ? null
      : parseMoney(input.totalPremiumsEur);

  if (before === null || after === null) {
    return {
      ok: false,
      premiumsBefore2017Eur: "0",
      premiumsAfter2017Eur: "0",
      totalPremiumsEur: "0",
      beforeShare: 0,
      afterShare: 0,
      error: "Montants de versements invalides",
    };
  }
  if (before < 0 || after < 0) {
    return {
      ok: false,
      premiumsBefore2017Eur: formatMoney(before),
      premiumsAfter2017Eur: formatMoney(after),
      totalPremiumsEur: "0",
      beforeShare: 0,
      afterShare: 0,
      error: "Les versements ne peuvent pas être négatifs",
    };
  }
  if (declared !== null && (declared < 0 || !Number.isFinite(declared))) {
    return {
      ok: false,
      premiumsBefore2017Eur: formatMoney(before),
      premiumsAfter2017Eur: formatMoney(after),
      totalPremiumsEur: "0",
      beforeShare: 0,
      afterShare: 0,
      error: "Total versé invalide",
    };
  }

  const sum = before + after;
  if (declared !== null && Math.abs(declared - sum) > MONEY_EPS) {
    return {
      ok: false,
      premiumsBefore2017Eur: formatMoney(before),
      premiumsAfter2017Eur: formatMoney(after),
      totalPremiumsEur: formatMoney(sum),
      beforeShare: 0,
      afterShare: 0,
      error: `La somme des versements (${formatMoney(sum)} €) ne correspond pas au total déclaré (${formatMoney(declared)} €)`,
    };
  }

  const total = declared !== null ? declared : sum;
  const beforeShare = total > MONEY_EPS ? before / total : 0;
  const afterShare = total > MONEY_EPS ? after / total : 0;

  return {
    ok: true,
    premiumsBefore2017Eur: formatMoney(before),
    premiumsAfter2017Eur: formatMoney(after),
    totalPremiumsEur: formatMoney(total),
    beforeShare,
    afterShare,
  };
}

/**
 * Encours total d'assurance-vie, tous contrats confondus.
 *
 * Le seuil de 150 000 € s'apprécie globalement : on ne stocke pas ce total en
 * base, on le recalcule à chaque lecture à partir des encours fournis.
 */
export function totalLifeInsuranceOutstandingEur(
  amountsEur: Array<string | number>
): string {
  let sum = 0;
  for (const raw of amountsEur) {
    const n = parseMoney(raw);
    if (n === null || n < 0) continue;
    sum += n;
  }
  return formatMoney(sum);
}

/** L'encours global dépasse-t-il le seuil ouvrant le régime 12,8 % majoritaire ? */
export function exceedsPfuOutstandingThreshold(
  totalOutstandingEur: string | number
): boolean {
  const n = parseMoney(totalOutstandingEur);
  if (n === null) return false;
  return n > PFU_OUTSTANDING_THRESHOLD_EUR;
}

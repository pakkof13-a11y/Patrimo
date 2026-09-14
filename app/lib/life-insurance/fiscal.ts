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

import { parisDayKey } from "@/app/lib/dates/paris";

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
 * Nombre de mois pleins entre deux dates, lues comme **jours civils
 * Europe/Paris**.
 *
 * Compté en mois calendaires plutôt qu'en jours divisés : l'antériorité
 * s'apprécie de date à date, et un contrat ouvert le 31 janvier a huit ans le
 * 31 janvier, sans qu'une année bissextile ne décale le seuil d'un jour.
 *
 * Pourquoi Paris et pas le fuseau du lecteur ni UTC :
 *
 * - Les accesseurs locaux (`getFullYear`…) répondaient dans le fuseau du
 *   lecteur, alors que la date d'ouverture est stockée à minuit **UTC**
 *   (`<input type="date">` → `new Date("2017-09-27")`). À l'ouest de
 *   Greenwich, cette date se lisait le 26 septembre : `hasAnteriority`
 *   basculait un jour trop tôt, et la branche « PFU 7,5 % » avec elle.
 * - UTC répare ce côté-là mais laisse l'autre : `now` est un instant, et son
 *   jour civil **en France** — celui du fait générateur, la date de l'opération
 *   chez l'assureur — commence à 22 h ou 23 h UTC la veille. Entre minuit et
 *   deux heures du matin, heure de Paris, le jour anniversaire des huit ans
 *   était encore « la veille » pour UTC.
 *
 * Passer les deux bornes par `parisDayKey` règle les deux cas : la date
 * stockée à 00:00Z tombe le même jour civil à Paris (01 h ou 02 h), et l'instant
 * courant tombe dans le bon jour. C'est la même règle que le reste du
 * portefeuille (`app/lib/dates/paris.ts`) ; `startOfUtcDay` de
 * `coupon-dates.ts` sert à *décoder* des dates stockées, pas à situer « now ».
 *
 * Rend `NaN` si l'une des bornes est illisible — comme l'arithmétique sur
 * `getFullYear()` le faisait avant le passage au jour civil Paris. `NaN` ne
 * franchit aucun seuil : `NaN >= 96` est faux. Le passage par `parisDayKey`
 * avait perdu cette propriété : la clé vide qu'il rend sur une date invalide
 * se lisait `Number("".slice(0, 4)) === 0`, et « pas une date » valait alors
 * l'an 0 — 24 321 mois d'antériorité, PFU à 7,5 % et abattement de 4 600 €.
 */
export function fullMonthsBetween(from: Date, to: Date): number {
  const f = parisYmd(from);
  const t = parisYmd(to);
  let months = (t.y - f.y) * 12 + (t.m - f.m);
  // Le mois n'est révolu que si le jour est atteint.
  if (t.d < f.d) months -= 1;
  return months;
}

const INVALID_YMD = { y: NaN, m: NaN, d: NaN } as const;

function parisYmd(date: Date): { y: number; m: number; d: number } {
  const key = parisDayKey(date);
  // `parisDayKey` rend "" sur une date invalide ; `Number("")` vaut 0, pas NaN.
  if (key === "") return INVALID_YMD;
  return {
    y: Number(key.slice(0, 4)),
    m: Number(key.slice(5, 7)),
    d: Number(key.slice(8, 10)),
  };
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
 *
 * Une date illisible rend le même âge nul, et donc **pas** d'antériorité. Le
 * garde vit ici et non seulement dans `fullMonthsBetween` : celle-ci rend
 * `NaN`, réponse honnête pour une arithmétique sans opérande, mais un verdict
 * fiscal ne se propage pas en `NaN` — `Math.max(0, NaN)` est `NaN`, et
 * `monthsToAnteriority` s'afficherait « dans NaN mois ». L'appelant qui ne
 * vérifie pas la lisibilité de la date (le simulateur de rachat ne teste que
 * sa présence) doit obtenir le régime le moins favorable, pas le plus.
 */
export function contractAge(openDate: Date, now: Date = new Date()): ContractAge {
  const raw = fullMonthsBetween(openDate, now);
  const months = Number.isFinite(raw) ? Math.max(0, raw) : 0;
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

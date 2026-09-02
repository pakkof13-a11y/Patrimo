/**
 * Réductions d'impôt des dispositifs immobiliers — Pinel, Denormandie,
 * Malraux, Loc'Avantages, Censi-Bouvard.
 *
 * Module pur. Deux choses que ce module fait, et qu'on rate facilement :
 *
 * 1. **La base est plafonnée deux fois, pas une.** En Pinel, le prix de
 *    revient est retenu dans la limite de 300 000 € *et* de 5 500 €/m². Un
 *    grand logement bon marché est plafonné par le prix ; un petit logement
 *    cher l'est par le mètre carré. Ne retenir qu'un des deux surestime la
 *    réduction dans un cas sur deux.
 * 2. **Le plafonnement global des niches fiscales** (10 000 €/an, art. 200-0 A)
 *    s'applique à Pinel, Denormandie, Censi-Bouvard et Loc'Avantages, mais
 *    **pas** à Malraux ni aux Monuments historiques. Cumuler deux Pinel sans
 *    en tenir compte annonce une économie que le contribuable ne touchera pas.
 *
 * Ce qui n'est **pas** modélisé, faute de pouvoir l'être honnêtement sans
 * données que l'application n'a pas : le respect des plafonds de loyer et de
 * ressources du locataire (qui conditionne le droit à réduction), le zonage
 * A/Abis/B1, et la reprise de la réduction en cas de rupture d'engagement.
 * Le calcul suppose donc l'engagement tenu.
 */

import { d, zero, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";

/** Plafond global des niches fiscales, par an et par foyer (art. 200-0 A). */
export const GLOBAL_TAX_BREAK_CAP = d(10_000);

/** Pinel / Denormandie : plafonds cumulatifs de la base. */
export const PINEL_BASE_CAP_EUR = d(300_000);
export const PINEL_BASE_CAP_PER_M2 = d(5_500);

/** Malraux : plafond de travaux, apprécié sur quatre années. */
export const MALRAUX_WORKS_CAP_EUR = d(400_000);

/** Censi-Bouvard : 11 % du prix de revient, plafond 300 000 €, sur 9 ans. */
export const CENSI_BOUVARD_RATE = d("0.11");
export const CENSI_BOUVARD_CAP_EUR = d(300_000);
export const CENSI_BOUVARD_YEARS = 9;

export type SchemeKind =
  | "PINEL"
  | "PINEL_PLUS"
  | "DENORMANDIE"
  | "MALRAUX"
  | "MONUMENT_HISTORIQUE"
  | "LOC_AVANTAGES"
  | "CENSI_BOUVARD"
  | "DEFICIT_FONCIER"
  | "AUCUN";

/** Dispositifs soumis au plafonnement global des niches. */
export const CAPPED_SCHEMES: readonly SchemeKind[] = [
  "PINEL",
  "PINEL_PLUS",
  "DENORMANDIE",
  "CENSI_BOUVARD",
  "LOC_AVANTAGES",
];

export function isCappedScheme(scheme: string): boolean {
  return (CAPPED_SCHEMES as readonly string[]).includes(scheme);
}

/**
 * Taux global de réduction Pinel selon l'année d'acquisition et la durée
 * d'engagement.
 *
 * Le dispositif a été mis en extinction : les taux ont été rabotés en 2023
 * puis en 2024, et aucune acquisition nouvelle n'y ouvre droit après 2024.
 * Pinel+ (qualité d'usage) conserve les taux pleins sur toute la période.
 */
export function pinelTotalRate(
  year: number,
  commitmentYears: number,
  plus = false
): Decimal {
  const full: Record<number, string> = { 6: "0.12", 9: "0.18", 12: "0.21" };
  const y2023: Record<number, string> = { 6: "0.105", 9: "0.15", 12: "0.175" };
  const y2024: Record<number, string> = { 6: "0.09", 9: "0.12", 12: "0.14" };

  const table = plus || year <= 2022 ? full : year === 2023 ? y2023 : y2024;
  const rate = table[commitmentYears];
  return rate ? d(rate) : zero();
}

/**
 * Base éligible Pinel / Denormandie : prix de revient plafonné à 300 000 €
 * **et** à 5 500 €/m². Le plus contraignant des deux s'applique.
 */
export function pinelEligibleBase(
  costPriceEur: DecimalInput,
  surfaceM2?: DecimalInput | null
): Decimal {
  let base = d(costPriceEur);
  if (base.lt(0)) return zero();

  if (surfaceM2 != null) {
    const surfaceCap = d(surfaceM2).times(PINEL_BASE_CAP_PER_M2);
    if (surfaceCap.gt(0) && base.gt(surfaceCap)) base = surfaceCap;
  }
  return base.gt(PINEL_BASE_CAP_EUR) ? PINEL_BASE_CAP_EUR : base;
}

export type SchemeInput = {
  scheme: string;
  /** Année de l'investissement — détermine le barème applicable. */
  startYear: number;
  /** Durée d'engagement en années (6, 9 ou 12 pour Pinel). */
  commitmentYears?: number | null;
  /** Prix de revient du logement, ou montant des travaux pour Malraux. */
  baseEur?: DecimalInput | null;
  /** Surface habitable — nécessaire au plafond de 5 500 €/m². */
  surfaceM2?: DecimalInput | null;
  /** Taux Malraux : 30 % (PSMV) ou 22 % (PVAP). */
  malrauxRatePct?: DecimalInput | null;
  /** Loc'Avantages : taux de réduction retenu selon le niveau de loyer. */
  locAvantagesRatePct?: DecimalInput | null;
  /** Recettes brutes annuelles — base de Loc'Avantages. */
  grossRentEur?: DecimalInput | null;
  /** Année pour laquelle on calcule (défaut : année courante). */
  currentYear?: number;
};

export type SchemeResult = {
  scheme: string;
  /** Base effectivement retenue après plafonnement. */
  eligibleBaseEur: Decimal;
  /** Réduction totale sur toute la durée. */
  totalReductionEur: Decimal;
  /** Réduction imputable sur l'année en cours. */
  annualReductionEur: Decimal;
  /** Années d'engagement déjà écoulées. */
  yearsElapsed: number;
  /** Années restantes avant la fin de l'engagement. */
  yearsRemaining: number;
  /** Vrai si l'engagement est terminé — plus aucune réduction. */
  finished: boolean;
  /** Soumis au plafond global de 10 000 €. */
  subjectToGlobalCap: boolean;
  /** Base plafonnée : signale à l'utilisateur qu'il perd une partie. */
  baseWasCapped: boolean;
  /** Explication courte, affichable telle quelle. */
  note: string | null;
};

const empty = (scheme: string, note: string | null = null): SchemeResult => ({
  scheme,
  eligibleBaseEur: zero(),
  totalReductionEur: zero(),
  annualReductionEur: zero(),
  yearsElapsed: 0,
  yearsRemaining: 0,
  finished: false,
  subjectToGlobalCap: false,
  baseWasCapped: false,
  note,
});

/**
 * Réduction annuelle d'un Pinel.
 *
 * L'étalement n'est pas uniforme sur 12 ans : les neuf premières années
 * portent les 18/21 de la réduction, les trois dernières le solde. Diviser
 * simplement par douze surestimerait les dernières années et sous-estimerait
 * les premières.
 */
function pinelAnnualReduction(
  total: Decimal,
  commitmentYears: number,
  yearIndex: number
): Decimal {
  if (yearIndex < 0 || yearIndex >= commitmentYears) return zero();

  if (commitmentYears !== 12) {
    return total.div(commitmentYears);
  }
  const firstNine = total.times(18).div(21);
  const lastThree = total.minus(firstNine);
  return yearIndex < 9 ? firstNine.div(9) : lastThree.div(3);
}

export function computeSchemeReduction(input: SchemeInput): SchemeResult {
  const scheme = input.scheme;
  const currentYear = input.currentYear ?? new Date().getFullYear();
  const yearsElapsed = Math.max(0, currentYear - input.startYear);

  if (scheme === "AUCUN" || scheme === "DEFICIT_FONCIER") {
    // Le déficit foncier n'est pas une réduction d'impôt mais une imputation
    // sur le revenu : il est traité par `rental-income.ts`.
    return empty(scheme, null);
  }

  if (scheme === "MONUMENT_HISTORIQUE") {
    return {
      ...empty(scheme),
      note:
        "Les Monuments historiques ouvrent droit à une déduction des charges du revenu global, sans plafond — et non à une réduction d'impôt. Le montant dépend de vos travaux et de votre revenu global, hors du périmètre de ce calcul.",
    };
  }

  if (scheme === "MALRAUX") {
    const works = d(input.baseEur ?? 0);
    if (works.lte(0)) return empty(scheme, "Montant des travaux non renseigné");

    const capped = works.gt(MALRAUX_WORKS_CAP_EUR) ? MALRAUX_WORKS_CAP_EUR : works;
    const rate = d(input.malrauxRatePct ?? 30).div(100);
    const total = capped.times(rate);
    // Les travaux Malraux s'étalent sur la durée du chantier, généralement
    // quatre ans — le plafond de 400 000 € s'apprécie sur cette période.
    const years = 4;
    const elapsed = Math.min(yearsElapsed, years);

    return {
      scheme,
      eligibleBaseEur: capped,
      totalReductionEur: total,
      annualReductionEur: elapsed < years ? total.div(years) : zero(),
      yearsElapsed: elapsed,
      yearsRemaining: Math.max(0, years - elapsed),
      finished: elapsed >= years,
      subjectToGlobalCap: false,
      baseWasCapped: works.gt(MALRAUX_WORKS_CAP_EUR),
      note: "Hors plafonnement global des niches fiscales.",
    };
  }

  if (scheme === "LOC_AVANTAGES") {
    const rent = d(input.grossRentEur ?? 0);
    if (rent.lte(0)) return empty(scheme, "Recettes locatives non renseignées");

    const rate = d(input.locAvantagesRatePct ?? 0).div(100);
    if (rate.lte(0)) return empty(scheme, "Taux de réduction non renseigné");

    // La réduction s'applique aux revenus bruts de chaque année de
    // convention, et non à un prix de revient immobilisé.
    const years = input.commitmentYears ?? 6;
    const annual = rent.times(rate);
    const elapsed = Math.min(yearsElapsed, years);

    return {
      scheme,
      eligibleBaseEur: rent,
      totalReductionEur: annual.times(years),
      annualReductionEur: elapsed < years ? annual : zero(),
      yearsElapsed: elapsed,
      yearsRemaining: Math.max(0, years - elapsed),
      finished: elapsed >= years,
      subjectToGlobalCap: true,
      baseWasCapped: false,
      note: null,
    };
  }

  if (scheme === "CENSI_BOUVARD") {
    const cost = d(input.baseEur ?? 0);
    if (cost.lte(0)) return empty(scheme, "Prix de revient non renseigné");

    const capped = cost.gt(CENSI_BOUVARD_CAP_EUR) ? CENSI_BOUVARD_CAP_EUR : cost;
    const total = capped.times(CENSI_BOUVARD_RATE);
    const elapsed = Math.min(yearsElapsed, CENSI_BOUVARD_YEARS);

    return {
      scheme,
      eligibleBaseEur: capped,
      totalReductionEur: total,
      annualReductionEur:
        elapsed < CENSI_BOUVARD_YEARS ? total.div(CENSI_BOUVARD_YEARS) : zero(),
      yearsElapsed: elapsed,
      yearsRemaining: Math.max(0, CENSI_BOUVARD_YEARS - elapsed),
      finished: elapsed >= CENSI_BOUVARD_YEARS,
      subjectToGlobalCap: true,
      baseWasCapped: cost.gt(CENSI_BOUVARD_CAP_EUR),
      note: "Dispositif clos aux acquisitions postérieures à 2022.",
    };
  }

  // ── Pinel, Pinel+ et Denormandie : même base et même barème ──
  const cost = d(input.baseEur ?? 0);
  if (cost.lte(0)) return empty(scheme, "Prix de revient non renseigné");

  const commitment = input.commitmentYears ?? 9;
  if (![6, 9, 12].includes(commitment)) {
    return empty(scheme, "L'engagement doit être de 6, 9 ou 12 ans");
  }

  const base = pinelEligibleBase(cost, input.surfaceM2);
  const rate = pinelTotalRate(input.startYear, commitment, scheme === "PINEL_PLUS");

  if (rate.lte(0)) {
    return empty(
      scheme,
      `Aucun taux applicable pour un investissement de ${input.startYear}.`
    );
  }

  const total = base.times(rate);
  const elapsed = Math.min(yearsElapsed, commitment);

  return {
    scheme,
    eligibleBaseEur: base,
    totalReductionEur: total,
    annualReductionEur: pinelAnnualReduction(total, commitment, elapsed),
    yearsElapsed: elapsed,
    yearsRemaining: Math.max(0, commitment - elapsed),
    finished: elapsed >= commitment,
    subjectToGlobalCap: true,
    baseWasCapped: base.lt(cost),
    note:
      commitment === 12
        ? "Étalement non uniforme : 18/21 de la réduction sur les neuf premières années, le solde sur les trois dernières."
        : null,
  };
}

export type SchemesSummary = {
  results: SchemeResult[];
  /** Réduction annuelle cumulée, avant plafonnement global. */
  totalAnnualEur: Decimal;
  /** Part soumise au plafond de 10 000 €. */
  cappedAnnualEur: Decimal;
  /** Part hors plafond (Malraux). */
  uncappedAnnualEur: Decimal;
  /** Montant perdu par le plafonnement global. */
  cappedAwayEur: Decimal;
  /** Réduction effectivement imputable après plafonnement. */
  effectiveAnnualEur: Decimal;
};

/**
 * Agrège plusieurs dispositifs en appliquant le plafonnement global.
 *
 * Le plafond de 10 000 € porte sur la somme des avantages concernés, pas sur
 * chacun pris isolément : deux Pinel de 6 000 € annoncent 12 000 € mais n'en
 * procurent que 10 000. C'est la raison d'être de cette fonction.
 */
export function summarizeSchemes(
  results: readonly SchemeResult[]
): SchemesSummary {
  let capped = zero();
  let uncapped = zero();

  for (const r of results) {
    if (r.subjectToGlobalCap) capped = capped.plus(r.annualReductionEur);
    else uncapped = uncapped.plus(r.annualReductionEur);
  }

  const allowed = capped.gt(GLOBAL_TAX_BREAK_CAP) ? GLOBAL_TAX_BREAK_CAP : capped;
  const lost = capped.minus(allowed);

  return {
    results: [...results],
    totalAnnualEur: capped.plus(uncapped),
    cappedAnnualEur: capped,
    uncappedAnnualEur: uncapped,
    cappedAwayEur: lost,
    effectiveAnnualEur: allowed.plus(uncapped),
  };
}

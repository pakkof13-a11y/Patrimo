/**
 * Coût de possession d'un actif tangible.
 *
 * Un objet de collection ne dort pas gratuitement : il se garde, il s'assure,
 * et ces frais courent chaque année sans jamais apparaître dans la plus-value
 * affichée. Une montre achetée 9 500 € et estimée 12 800 € montre +3 300 € —
 * mais si elle coûte 300 € par an de coffre et d'assurance depuis sept ans,
 * le gain réel est de 1 200 €. C'est cet écart que le module rend visible.
 *
 * ## Ce que ce calcul n'est pas
 *
 * Le résultat est **informatif, jamais fiscal**. Les frais de garde et les
 * primes d'assurance ne sont pas déductibles de la plus-value imposable au
 * titre de l'article 150 VI : l'assiette du régime réel ne connaît que le prix
 * d'acquisition et les frais de restauration ou de remise en état. Rien de ce
 * fichier n'alimente `tax/movable-assets.ts`, et l'écran doit dire lequel des
 * deux chiffres il montre.
 *
 * ## Le coût est reconstitué, pas historisé
 *
 * Faute d'un journal des dépenses, le cumul est une projection : coût annuel
 * courant × années de détention. Elle suppose un coût constant depuis
 * l'acquisition, ce qui est faux dans le détail mais donne le bon ordre de
 * grandeur — et c'est l'ordre de grandeur qui change la décision de garder ou
 * de vendre.
 */

import { d, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";

export const STORAGE_TYPES = [
  "HOME",
  "BANK_VAULT",
  "PRO_VAULT",
  "THIRD_PARTY",
] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];

export const STORAGE_TYPE_LABELS: Record<StorageType, string> = {
  HOME: "Domicile",
  BANK_VAULT: "Coffre bancaire",
  PRO_VAULT: "Dépositaire spécialisé",
  THIRD_PARTY: "Chez un tiers",
};

/** Gardes externalisées : l'objet n'est pas sous le toit du propriétaire. */
export const EXTERNAL_STORAGE_TYPES: readonly StorageType[] = [
  "BANK_VAULT",
  "PRO_VAULT",
  "THIRD_PARTY",
];

/**
 * Seuil au-delà duquel le coût de garde est signalé, en part de la valeur.
 *
 * 1 % par an paraît modeste et ne l'est pas : sur vingt ans, c'est un
 * cinquième de la valeur de l'objet parti en frais.
 */
export const HIGH_CUSTODY_COST_RATIO = "0.01";

/** Préavis de renouvellement du contrat de garde. */
export const RENEWAL_NOTICE_DAYS = 60;

/**
 * Valeur au-delà de laquelle une conservation au domicile sans assurance est
 * signalée. En dessous, l'alerte serait du bruit.
 */
export const HIGH_VALUE_UNINSURED_EUR = "5000";

export type OwnershipCostInput = {
  insurancePremiumAnnual?: DecimalInput | null;
  storageCostAnnual?: DecimalInput | null;
};

/** Somme des charges récurrentes : prime d'assurance + garde. */
export function annualCostOfOwnership(input: OwnershipCostInput): Decimal {
  return d(input.insurancePremiumAnnual ?? 0).plus(d(input.storageCostAnnual ?? 0));
}

export type CarryYieldInput = {
  estimatedValue: DecimalInput;
  purchasePrice: DecimalInput;
  /** Années révolues de détention — `null` quand la date d'achat manque. */
  holdingYears: number | null;
  annualCost: DecimalInput;
};

export type CarryYield = {
  grossPnlEur: string;
  /** Coût annuel × années de détention, `null` sans durée connue. */
  totalCarryCostEur: string | null;
  /** Plus-value diminuée du portage — `null` si le cumul est inconnu. */
  netPnlEur: string | null;
  /** Rendement net rapporté au prix d'achat, en %. */
  netPnlPct: string | null;
  /** Part du gain brut absorbée par les frais, en % — `null` sans gain. */
  carryDragPct: string | null;
};

/**
 * Plus-value nette des frais de détention.
 *
 * Sans date d'achat, le cumul n'est pas calculable : le module renvoie `null`
 * plutôt qu'un zéro, qui se lirait comme « aucun frais » alors qu'il signifie
 * « on ne sait pas ».
 */
export function netCarryYield(input: CarryYieldInput): CarryYield {
  const value = d(input.estimatedValue);
  const cost = d(input.purchasePrice);
  const annual = d(input.annualCost);
  const grossPnl = value.minus(cost);

  if (input.holdingYears === null) {
    return {
      grossPnlEur: grossPnl.toFixed(2),
      totalCarryCostEur: null,
      netPnlEur: null,
      netPnlPct: null,
      carryDragPct: null,
    };
  }

  const totalCarry = annual.times(Math.max(0, input.holdingYears));
  const netPnl = grossPnl.minus(totalCarry);

  return {
    grossPnlEur: grossPnl.toFixed(2),
    totalCarryCostEur: totalCarry.toFixed(2),
    netPnlEur: netPnl.toFixed(2),
    netPnlPct: cost.gt(0) ? netPnl.div(cost).times(100).toFixed(2) : null,
    // La part du gain mangée par le portage n'a de sens que s'il y a un gain :
    // sur une moins-value, le ratio serait négatif et illisible.
    carryDragPct: grossPnl.gt(0)
      ? totalCarry.div(grossPnl).times(100).toFixed(1)
      : null,
  };
}

// ─── Couverture d'assurance ─────────────────────────────────────────────────

export const INSURANCE_TYPES = [
  "MULTI_RISK",
  "FINE_ART",
  "JEWELRY",
  "WATCH",
  "OTHER",
] as const;
export type InsuranceType = (typeof INSURANCE_TYPES)[number];

export const INSURANCE_TYPE_LABELS: Record<InsuranceType, string> = {
  MULTI_RISK: "Multirisque habitation",
  FINE_ART: "Objets d'art",
  JEWELRY: "Bijoux & pierres",
  WATCH: "Horlogerie",
  OTHER: "Autre",
};

/**
 * Contrats qui ne couvrent pas spécifiquement les objets de valeur.
 *
 * Une multirisque habitation plafonne le poste « objets précieux » à quelques
 * milliers d'euros, souvent 5 à 10 % du mobilier assuré : déclarer 30 000 € de
 * capital sur une MRH ne garantit pas 30 000 €. Le module ne connaît pas le
 * plafond du contrat, mais il peut au moins signaler la situation.
 */
export const NON_SPECIFIC_INSURANCE_TYPES: readonly InsuranceType[] = ["MULTI_RISK"];

/** En dessous, la couverture est jugée insuffisante. */
export const UNDER_INSURED_RATIO = "0.8";
/** Au-dessus, on paie une prime pour une valeur qu'on ne récupérera pas. */
export const OVER_INSURED_RATIO = "1.2";
/** Préavis d'échéance de police. */
export const POLICY_NOTICE_DAYS = 30;
/** Au-delà, une expertise ne reflète plus le marché. */
export const STALE_APPRAISAL_YEARS = 5;

export const INSURANCE_STATUSES = [
  "NONE",
  "EXPIRED",
  "EXPIRING",
  "UNDER",
  "OVER",
  "OK",
] as const;
export type InsuranceStatus = (typeof INSURANCE_STATUSES)[number];

export const INSURANCE_STATUS_LABELS: Record<InsuranceStatus, string> = {
  NONE: "Non assuré",
  EXPIRED: "Police échue",
  EXPIRING: "Police à renouveler",
  UNDER: "Sous-assuré",
  OVER: "Sur-assuré",
  OK: "Couverture adéquate",
};

/**
 * Rapport entre capital assuré et valeur estimée.
 *
 * `null` quand l'un des deux manque : un ratio calculé sur une valeur absente
 * vaudrait zéro et se lirait « sous-assuré », alors qu'on ne sait rien.
 */
export function coverageRatio(
  estimatedValue: DecimalInput,
  insuranceValue: DecimalInput | null | undefined
): Decimal | null {
  if (insuranceValue === null || insuranceValue === undefined) return null;
  const value = d(estimatedValue);
  if (value.lte(0)) return null;
  return d(insuranceValue).div(value);
}

export function isUnderInsured(ratio: Decimal): boolean {
  return ratio.lt(UNDER_INSURED_RATIO);
}

export function isOverInsured(ratio: Decimal): boolean {
  return ratio.gt(OVER_INSURED_RATIO);
}

export type InsuranceStatusInput = {
  estimatedValue: DecimalInput;
  insuranceValue?: DecimalInput | null;
  insuranceExpiryDate?: Date | string | null;
  now?: Date;
};

/**
 * Statut de couverture, du plus grave au plus anodin.
 *
 * L'ordre compte : une police échue ne couvre rien, quel que soit son capital.
 * Annoncer « sous-assuré » sur un contrat expiré laisserait croire qu'il suffit
 * d'augmenter le capital.
 */
export function insuranceStatus(input: InsuranceStatusInput): InsuranceStatus {
  const ratio = coverageRatio(input.estimatedValue, input.insuranceValue);
  if (ratio === null || d(input.insuranceValue ?? 0).lte(0)) return "NONE";

  const now = input.now ?? new Date();
  const expiry = toDate(input.insuranceExpiryDate);
  if (expiry) {
    const days = daysUntil(expiry, now);
    if (days < 0) return "EXPIRED";
    if (days <= POLICY_NOTICE_DAYS) return "EXPIRING";
  }

  if (isUnderInsured(ratio)) return "UNDER";
  if (isOverInsured(ratio)) return "OVER";
  return "OK";
}

export const OWNERSHIP_ALERTS = [
  "POLICY_EXPIRED",
  "UNDER_INSURED",
  "UNINSURED_AT_HOME",
  "POLICY_EXPIRING",
  "HIGH_CUSTODY_COST",
  "RENEWAL_DUE",
  "NON_SPECIFIC_COVER",
  "STALE_APPRAISAL",
  "OVER_INSURED",
  "CARRY_EXCEEDS_GAIN",
] as const;
export type OwnershipAlertCode = (typeof OWNERSHIP_ALERTS)[number];

export type OwnershipAlert = {
  code: OwnershipAlertCode;
  message: string;
};

export type AlertInput = {
  estimatedValue: DecimalInput;
  storageCostAnnual?: DecimalInput | null;
  insurancePremiumAnnual?: DecimalInput | null;
  insuranceValue?: DecimalInput | null;
  insuranceExpiryDate?: Date | string | null;
  insuranceType?: string | null;
  appraisalDate?: Date | string | null;
  storageType?: string | null;
  storageRenewalDate?: Date | string | null;
  /** Cumul du portage, tel que renvoyé par `netCarryYield`. */
  totalCarryCostEur?: string | null;
  grossPnlEur?: string | null;
  now?: Date;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eur(value: Decimal): string {
  return `${Number(value.toFixed(2)).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/** Jours calendaires restants avant une échéance, négatif si dépassée. */
export function daysUntil(target: Date, now: Date): number {
  const MS_PER_DAY = 86_400_000;
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const to = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate()
  );
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Alertes de possession, dans l'ordre où elles méritent d'être lues.
 *
 * Chaque alerte porte son chiffre : « coût de garde élevé » sans montant
 * n'aide personne à décider s'il faut renégocier le contrat.
 */
export function ownershipAlerts(input: AlertInput): OwnershipAlert[] {
  const alerts: OwnershipAlert[] = [];
  const now = input.now ?? new Date();
  const value = d(input.estimatedValue);
  const storage = d(input.storageCostAnnual ?? 0);
  const premium = d(input.insurancePremiumAnnual ?? 0);

  const insured = d(input.insuranceValue ?? 0);
  const ratio = coverageRatio(input.estimatedValue, input.insuranceValue);

  // Police d'abord : échue, elle ne couvre rien, et signaler autre chose
  // laisserait croire qu'ajuster le capital suffirait.
  const policyExpiry = toDate(input.insuranceExpiryDate);
  if (policyExpiry && insured.gt(0)) {
    const days = daysUntil(policyExpiry, now);
    if (days < 0) {
      alerts.push({
        code: "POLICY_EXPIRED",
        message: `Police d'assurance échue depuis ${Math.abs(days)} jour(s) : l'objet n'est plus couvert.`,
      });
    } else if (days <= POLICY_NOTICE_DAYS) {
      alerts.push({
        code: "POLICY_EXPIRING",
        message: `Police d'assurance à renouveler dans ${days} jour(s).`,
      });
    }
  }

  if (ratio !== null && insured.gt(0) && isUnderInsured(ratio)) {
    alerts.push({
      code: "UNDER_INSURED",
      message: `Couverture à ${ratio.times(100).toFixed(0)} % de la valeur : ${eur(
        d(input.estimatedValue).minus(insured)
      )} resteraient à votre charge.`,
    });
  }

  if (ratio !== null && isOverInsured(ratio)) {
    // L'indemnisation ne dépasse pas la valeur réelle du bien : la fraction
    // au-delà est une prime payée pour rien.
    alerts.push({
      code: "OVER_INSURED",
      message: `Capital assuré à ${ratio.times(100).toFixed(0)} % de la valeur : prime payée sur ${eur(
        insured.minus(d(input.estimatedValue))
      )} non indemnisables.`,
    });
  }

  if (
    insured.gt(0) &&
    input.insuranceType !== null &&
    input.insuranceType !== undefined &&
    (NON_SPECIFIC_INSURANCE_TYPES as readonly string[]).includes(input.insuranceType) &&
    d(input.estimatedValue).gte(HIGH_VALUE_UNINSURED_EUR)
  ) {
    alerts.push({
      code: "NON_SPECIFIC_COVER",
      message:
        "Couvert par une multirisque habitation : le poste « objets de valeur » y est plafonné, vérifiez que le capital est réellement garanti.",
    });
  }

  // Une expertise ancienne ne dit plus rien du marché, et c'est sur elle que
  // repose le capital assuré.
  const appraisal = toDate(input.appraisalDate);
  if (appraisal) {
    const age = now.getUTCFullYear() - appraisal.getUTCFullYear();
    if (age >= STALE_APPRAISAL_YEARS) {
      alerts.push({
        code: "STALE_APPRAISAL",
        message: `Dernière expertise il y a ${age} ans : à renouveler pour ajuster la couverture.`,
      });
    }
  }

  const renewal = toDate(input.storageRenewalDate);
  if (renewal) {
    const days = daysUntil(renewal, now);
    if (days < 0) {
      alerts.push({
        code: "RENEWAL_DUE",
        message: `Contrat de garde échu depuis ${Math.abs(days)} jour(s).`,
      });
    } else if (days <= RENEWAL_NOTICE_DAYS) {
      alerts.push({
        code: "RENEWAL_DUE",
        message: `Contrat de garde à renouveler dans ${days} jour(s).`,
      });
    }
  }

  // Un objet de valeur gardé au domicile et non assuré : le sinistre est
  // intégralement à la charge du propriétaire.
  if (
    input.storageType === "HOME" &&
    premium.lte(0) &&
    value.gte(HIGH_VALUE_UNINSURED_EUR)
  ) {
    alerts.push({
      code: "UNINSURED_AT_HOME",
      message: `${eur(value)} conservés au domicile sans prime d'assurance déclarée.`,
    });
  }

  if (value.gt(0) && storage.div(value).gt(HIGH_CUSTODY_COST_RATIO)) {
    const pct = storage.div(value).times(100).toFixed(1);
    alerts.push({
      code: "HIGH_CUSTODY_COST",
      message: `Garde à ${eur(storage)} par an, soit ${pct.replace(".", ",")} % de la valeur.`,
    });
  }

  // Le cas qui renverse une décision : l'objet s'est apprécié, mais les frais
  // ont mangé plus que le gain.
  const carry = input.totalCarryCostEur;
  const gross = input.grossPnlEur;
  if (carry !== null && carry !== undefined && gross !== null && gross !== undefined) {
    const carryDec = d(carry);
    const grossDec = d(gross);
    if (carryDec.gt(0) && grossDec.gt(0) && carryDec.gt(grossDec)) {
      alerts.push({
        code: "CARRY_EXCEEDS_GAIN",
        message: `Frais de détention cumulés (${eur(carryDec)}) supérieurs à la plus-value (${eur(grossDec)}).`,
      });
    }
  }

  // Ordre de gravité plutôt qu'ordre de calcul : la première alerte lue doit
  // être celle qui coûte le plus cher si on l'ignore.
  const severity = new Map<OwnershipAlertCode, number>(
    OWNERSHIP_ALERTS.map((code, index) => [code, index])
  );
  return alerts.sort(
    (a, b) => (severity.get(a.code) ?? 99) - (severity.get(b.code) ?? 99)
  );
}

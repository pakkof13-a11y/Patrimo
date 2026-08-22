/**
 * Agrégats du module Passifs.
 *
 * L'écran calculait ces totaux dans son propre corps de rendu, mêlés aux
 * filtres et au tri. Les en sortir n'en change aucun — les estimations de durée
 * et d'intérêts restent celles d'`amortization.ts`, la conversion celle du
 * service — mais permet de les tester, et de nommer les deux règles qui
 * comptent : un crédit soldé n'est plus une dette, et un taux moyen se pondère.
 *
 * Module **pur** : ni Prisma, ni React, ni réseau.
 */

import { repaymentProgressPct } from "./amortization";

/** Ce que `/api/liabilities` renvoie, réduit à ce dont l'écran a besoin. */
export type LiabilityInput = {
  id: string;
  name: string;
  initialAmount: string;
  remainingAmount: string;
  remainingEur: string;
  currency: string;
  interestRate: string | null;
  monthlyPayment: string | null;
  insuranceMonthly: string | null;
  startDate: string | null;
  endDate: string | null;
  bankName: string | null;
  category: string;
  monthsRemaining: number | null;
  estimatedInterestRemaining: string;
  linkedAsset: {
    id: string;
    name: string;
    category: string;
    accountType: string;
    manualPrice: string | null;
  } | null;
};

/**
 * Un crédit est **soldé** dès que son capital restant dû est nul.
 *
 * C'est la seule distinction qui compte pour les totaux : une dette remboursée
 * ne pèse plus, ne coûte plus de mensualité et n'a plus de taux à moyenner.
 * La garder dans les agrégats gonflerait le nombre de crédits et diluerait le
 * taux moyen vers zéro.
 */
export type LiabilityStatus = "ACTIVE" | "SETTLED";

export type LiabilityView = {
  id: string;
  name: string;
  category: string;
  lender: string | null;
  status: LiabilityStatus;
  remainingEur: number;
  initialEur: number;
  /** `initial − remaining`, jamais négatif. */
  repaidEur: number;
  /** Part remboursée en %, `null` si le capital initial est inconnu. */
  progressPct: number | null;
  monthlyPaymentEur: number | null;
  insuranceMonthlyEur: number | null;
  /** Mensualité assurance comprise, `null` sans mensualité renseignée. */
  totalMonthlyEur: number | null;
  ratePct: number | null;
  startDate: string | null;
  /** Fin déclarée, ou projetée depuis la durée résiduelle estimée. */
  endDate: string | null;
  /** `true` quand la fin vient d'une estimation et non d'une date saisie. */
  endDateIsEstimated: boolean;
  monthsRemaining: number | null;
  estimatedInterestRemainingEur: number;
  linkedAsset: LiabilityInput["linkedAsset"];
};

const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const opt = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Date de fin projetée depuis aujourd'hui + durée résiduelle estimée. */
function projectedEnd(monthsRemaining: number | null, now: Date): string | null {
  if (monthsRemaining == null || monthsRemaining <= 0) return null;
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + monthsRemaining);
  return d.toISOString();
}

export function buildLiabilityView(
  l: LiabilityInput,
  now = new Date()
): LiabilityView {
  const remainingEur = num(l.remainingEur);
  const initialEur = num(l.initialAmount);
  const status: LiabilityStatus = num(l.remainingAmount) > 0 ? "ACTIVE" : "SETTLED";

  const monthlyPaymentEur = opt(l.monthlyPayment);
  const insuranceMonthlyEur = opt(l.insuranceMonthly);

  /*
    L'assurance emprunteur ne s'ajoute à la mensualité que si celle-ci existe :
    une assurance seule ne fait pas une échéance, et l'afficher comme telle
    laisserait croire à un prélèvement qui n'a pas lieu.
  */
  const totalMonthlyEur =
    monthlyPaymentEur == null
      ? null
      : monthlyPaymentEur + (insuranceMonthlyEur ?? 0);

  const declaredEnd = l.endDate;
  const estimatedEnd = projectedEnd(l.monthsRemaining, now);

  return {
    id: l.id,
    name: l.name,
    category: l.category,
    lender: l.bankName,
    status,
    remainingEur,
    initialEur,
    repaidEur: Math.max(0, initialEur - num(l.remainingAmount)),
    /*
      Sans capital initial, aucun pourcentage n'est calculable — et en inventer
      un serait la pire information de l'écran : elle porterait sur ce que
      l'utilisateur a déjà remboursé.
    */
    progressPct:
      initialEur > 0
        ? repaymentProgressPct(l.initialAmount, l.remainingAmount)
        : null,
    monthlyPaymentEur,
    insuranceMonthlyEur,
    totalMonthlyEur,
    ratePct: opt(l.interestRate),
    startDate: l.startDate,
    endDate: declaredEnd ?? estimatedEnd,
    endDateIsEstimated: !declaredEnd && estimatedEnd != null,
    monthsRemaining: l.monthsRemaining,
    estimatedInterestRemainingEur: num(l.estimatedInterestRemaining),
    linkedAsset: l.linkedAsset,
  };
}

/**
 * Crédits du plus gros encours au plus petit, soldés en dernier.
 *
 * On lit d'abord ce qui pèse. Les crédits remboursés restent visibles — ils
 * font partie de l'histoire — mais ne disputent pas la tête de liste.
 */
export function buildLiabilityViews(
  rows: LiabilityInput[],
  now = new Date()
): LiabilityView[] {
  return rows
    .map((l) => buildLiabilityView(l, now))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "ACTIVE" ? -1 : 1;
      if (b.remainingEur !== a.remainingEur) return b.remainingEur - a.remainingEur;
      return a.name.localeCompare(b.name, "fr-FR");
    });
}

export type LiabilityTotals = {
  /** Capital restant dû, crédits actifs uniquement. */
  totalDebtEur: number;
  /** Somme des mensualités renseignées, assurance comprise. */
  monthlyEur: number;
  /** Part assurance de cette mensualité. */
  monthlyInsuranceEur: number;
  /**
   * Taux moyen **pondéré par le capital restant dû**, `null` si aucun crédit
   * actif ne porte de taux.
   */
  weightedRatePct: number | null;
  /** Intérêts restants estimés, crédits actifs. */
  estimatedInterestRemainingEur: number;
  activeCount: number;
  settledCount: number;
  /** Date de fin la plus lointaine — « quand serai-je libéré ? ». */
  lastEndDate: string | null;
  /** `true` si cette date repose sur au moins une estimation. */
  lastEndDateIsEstimated: boolean;
  /** Répartition du capital restant dû par catégorie. */
  byCategory: Array<{
    category: string;
    remainingEur: number;
    sharePct: number | null;
    count: number;
  }>;
};

export function computeLiabilityTotals(views: LiabilityView[]): LiabilityTotals {
  const active = views.filter((v) => v.status === "ACTIVE");

  let totalDebtEur = 0;
  let monthlyEur = 0;
  let monthlyInsuranceEur = 0;
  let estimatedInterestRemainingEur = 0;

  /*
    Taux moyen pondéré par l'encours.

    Une moyenne simple donnerait au crédit auto de 8 000 € à 3,90 % le même
    poids qu'au prêt immobilier de 182 000 € à 1,72 %, et annoncerait un taux
    moyen que l'emprunteur ne paie sur rien. Seuls les crédits qui portent
    réellement un taux entrent au dénominateur : un crédit sans taux n'est pas
    un crédit à 0 %.
  */
  let rateWeight = 0;
  let rateSum = 0;

  const byCat = new Map<string, { remainingEur: number; count: number }>();

  let lastEnd: number | null = null;
  let lastEndEstimated = false;

  for (const v of active) {
    totalDebtEur += v.remainingEur;
    estimatedInterestRemainingEur += v.estimatedInterestRemainingEur;

    if (v.totalMonthlyEur != null) {
      monthlyEur += v.totalMonthlyEur;
      monthlyInsuranceEur += v.insuranceMonthlyEur ?? 0;
    }

    if (v.ratePct != null && v.remainingEur > 0) {
      rateWeight += v.remainingEur;
      rateSum += v.ratePct * v.remainingEur;
    }

    const cur = byCat.get(v.category) ?? { remainingEur: 0, count: 0 };
    cur.remainingEur += v.remainingEur;
    cur.count += 1;
    byCat.set(v.category, cur);

    const t = v.endDate ? Date.parse(v.endDate) : NaN;
    if (Number.isFinite(t) && (lastEnd == null || t > lastEnd)) {
      lastEnd = t;
      lastEndEstimated = v.endDateIsEstimated;
    }
  }

  return {
    totalDebtEur,
    monthlyEur,
    monthlyInsuranceEur,
    weightedRatePct: rateWeight > 0 ? rateSum / rateWeight : null,
    estimatedInterestRemainingEur,
    activeCount: active.length,
    settledCount: views.length - active.length,
    lastEndDate: lastEnd != null ? new Date(lastEnd).toISOString() : null,
    lastEndDateIsEstimated: lastEndEstimated,
    byCategory: [...byCat.entries()]
      .map(([category, e]) => ({
        category,
        remainingEur: e.remainingEur,
        sharePct: totalDebtEur > 0 ? (e.remainingEur / totalDebtEur) * 100 : null,
        count: e.count,
      }))
      .sort((a, b) => b.remainingEur - a.remainingEur),
  };
}

/**
 * Poids de la dette dans le patrimoine.
 *
 * `null` quand le dénominateur est inconnu ou nul : un ratio sans patrimoine
 * de référence ne veut rien dire, et le montrer à 100 % ou à l'infini serait
 * pire que de ne rien montrer.
 */
export function debtToPatrimonyPct(
  totalDebtEur: number,
  grossAssetsEur: number | null | undefined
): number | null {
  if (grossAssetsEur == null || grossAssetsEur <= 0) return null;
  return (totalDebtEur / grossAssetsEur) * 100;
}

/**
 * Equity d'un bien financé : ce qu'il vaut, moins ce qu'il reste à devoir.
 *
 * C'est la lecture la plus parlante pour un particulier — « ce prêt finance ce
 * bien, le bien vaut X, il reste Y, donc j'ai Z ». `null` sans valeur connue :
 * un bien dont on ignore le prix ne donne pas une equity négative égale à la
 * dette, il ne donne rien.
 */
export function linkedAssetEquity(
  view: LiabilityView
): { valueEur: number; debtEur: number; equityEur: number } | null {
  const price = view.linkedAsset?.manualPrice;
  const valueEur = price == null || price === "" ? NaN : Number(price);
  if (!Number.isFinite(valueEur) || valueEur <= 0) return null;
  return {
    valueEur,
    debtEur: view.remainingEur,
    equityEur: valueEur - view.remainingEur,
  };
}

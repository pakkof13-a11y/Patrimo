/**
 * Suivi de valeur des objets tangibles — montre, œuvre, vin, voiture.
 *
 * Aucun de ces marchés ne cote : il n'existe pas de cours d'une Daytona 116500
 * comme il existe un cours de l'or. Inventer un indice donnerait une courbe
 * lisse et fausse. On enregistre donc ce qui existe réellement — des
 * **valorisations datées**, chacune avec sa source : une expertise, une
 * adjudication comparable, une cote de marché relevée, une estimation
 * personnelle — et la performance se déduit de ces points, sans rien combler
 * entre eux.
 *
 * Module pur : il ordonne, il déduit, il ne va rien chercher.
 */

import { d, zero, type Decimal, type DecimalInput } from "../money/decimal";

/**
 * Origine d'une valorisation, de la plus opposable à la plus subjective.
 *
 * La distinction n'est pas décorative : une expertise d'assurance et une
 * estimation personnelle ne se défendent pas de la même façon devant un
 * assureur ou une administration, et l'écran doit permettre de les
 * distinguer d'un coup d'œil.
 */
export const VALUATION_SOURCES = [
  "APPRAISAL",
  "AUCTION",
  "MARKET",
  "INSURANCE",
  "MANUAL",
] as const;
export type ValuationSource = (typeof VALUATION_SOURCES)[number];

export const VALUATION_SOURCE_LABELS: Record<ValuationSource, string> = {
  APPRAISAL: "Expertise",
  AUCTION: "Adjudication comparable",
  MARKET: "Cote de marché",
  INSURANCE: "Valeur assurée",
  MANUAL: "Estimation personnelle",
};

export type ValuationPoint = {
  /** Date de la valorisation, ISO. */
  valuedAt: string;
  valueEur: string | number;
  source: ValuationSource;
  note?: string | null;
};

export type ValuationTimeline = {
  /** Points retenus, du plus ancien au plus récent, achat compris. */
  points: { date: string; valueEur: number; source: ValuationSource | "PURCHASE" }[];
  /** Dernière valeur connue — celle qui fait foi pour le patrimoine. */
  currentValueEur: number | null;
  /** Date de cette dernière valeur : dit son âge, donc sa fiabilité. */
  currentValuedAt: string | null;
  /** Plus- ou moins-value depuis l'achat, en euros. */
  pnlEur: number | null;
  /** La même, en pourcentage du prix de revient. */
  pnlPct: number | null;
  /**
   * Rendement annualisé depuis l'achat.
   *
   * `null` sous un an de détention : ramener trois semaines de hausse à un
   * taux annuel produit des pourcentages à trois chiffres qui ne décrivent
   * rien. On préfère ne rien annoncer.
   */
  annualisedPct: number | null;
  /** Âge de la dernière valorisation, en jours. */
  staleDays: number | null;
};

function num(v: DecimalInput | null | undefined): Decimal {
  if (v == null) return zero();
  const parsed = d(v);
  return parsed.isNaN?.() ? zero() : parsed;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Construit la chronologie de valeur d'un objet.
 *
 * Le prix d'achat ouvre la série : c'est la seule valeur dont on soit certain,
 * et sans elle la courbe partirait de la première expertise, faisant
 * disparaître toute la performance antérieure.
 */
export function buildValuationTimeline(input: {
  purchasePriceEur?: DecimalInput | null;
  acquisitionFeesEur?: DecimalInput | null;
  purchaseDate?: string | Date | null;
  valuations: ValuationPoint[];
  now?: Date;
}): ValuationTimeline {
  const now = input.now ?? new Date();
  const costBasis = num(input.purchasePriceEur).plus(
    num(input.acquisitionFeesEur)
  );

  const points: ValuationTimeline["points"] = [];

  const purchaseDate = input.purchaseDate ? new Date(input.purchaseDate) : null;
  const hasPurchase =
    purchaseDate != null &&
    !Number.isNaN(purchaseDate.getTime()) &&
    costBasis.gt(0);
  if (hasPurchase) {
    points.push({
      date: purchaseDate!.toISOString(),
      valueEur: costBasis.toNumber(),
      source: "PURCHASE",
    });
  }

  for (const v of input.valuations) {
    const at = new Date(v.valuedAt);
    if (Number.isNaN(at.getTime())) continue;
    const value = num(v.valueEur);
    if (value.lte(0)) continue;
    points.push({
      date: at.toISOString(),
      valueEur: value.toNumber(),
      source: v.source,
    });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));

  // Le dernier point *non issu de l'achat* fait la valeur courante : un objet
  // acheté puis jamais réestimé vaut son prix d'achat, ce que dit déjà le
  // point d'achat lui-même.
  const last = points[points.length - 1];
  const currentValueEur = last ? last.valueEur : null;
  const currentValuedAt = last ? last.date : null;

  let pnlEur: number | null = null;
  let pnlPct: number | null = null;
  let annualisedPct: number | null = null;

  if (currentValueEur != null && costBasis.gt(0)) {
    const pnl = d(currentValueEur).minus(costBasis);
    pnlEur = pnl.toNumber();
    pnlPct = pnl.div(costBasis).times(100).toNumber();

    if (hasPurchase) {
      const years =
        (new Date(currentValuedAt!).getTime() - purchaseDate!.getTime()) /
        (365.25 * DAY_MS);
      if (years >= 1) {
        const ratio = d(currentValueEur).div(costBasis).toNumber();
        annualisedPct = (Math.pow(ratio, 1 / years) - 1) * 100;
      }
    }
  }

  const staleDays =
    currentValuedAt == null
      ? null
      : Math.max(
          0,
          Math.floor((now.getTime() - new Date(currentValuedAt).getTime()) / DAY_MS)
        );

  return {
    points,
    currentValueEur,
    currentValuedAt,
    pnlEur,
    pnlPct,
    annualisedPct,
    staleDays,
  };
}

/**
 * Seuil au-delà duquel une valorisation mérite d'être rafraîchie.
 *
 * Dix-huit mois : au-delà, la valeur affichée relève du souvenir plus que de
 * l'estimation, et une couverture d'assurance calée dessus devient
 * insuffisante sans que rien ne l'ait signalé.
 */
export const STALE_VALUATION_DAYS = 548;

export function isStaleValuation(staleDays: number | null): boolean {
  return staleDays != null && staleDays > STALE_VALUATION_DAYS;
}

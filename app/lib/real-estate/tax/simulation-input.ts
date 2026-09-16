/**
 * Garde d'entrée du simulateur de plus-value immobilière.
 *
 * Ce module ne calcule rien : il décide si les entrées de l'écran permettent
 * d'appeler le moteur (`capital-gain.ts`), qui reste inchangé.
 *
 * La raison d'être du fichier tient en une ligne : `Number("")` vaut `0`, et
 * `d("")` vaut `0` lui aussi (app/lib/money/decimal.ts). Un prix de cession
 * non saisi devenait donc une cession à titre gratuit, c'est-à-dire une
 * moins-value égale au prix de revient — un chiffre faux, affiché avec le même
 * aplomb qu'un chiffre juste. Une saisie absente est INCONNUE, pas nulle : on
 * refuse de calculer plutôt que de produire un montant.
 */

import {
  computeCapitalGain,
  type CapitalGainInput,
  type CapitalGainResult,
} from "@/app/lib/real-estate/tax/capital-gain";

/** Pourquoi la simulation ne peut pas aboutir, quand elle n'aboutit pas. */
export type CapitalGainSimulationStatus =
  | "OK"
  /** Prix de cession absent ou illisible : rien à afficher, pas même un zéro. */
  | "MISSING_SALE_PRICE"
  /** Date de cession absente ou illisible (champ `type="date"` effacé). */
  | "MISSING_SALE_DATE"
  /** Le journal ne porte ni date ni prix d'acquisition pour ce bien. */
  | "MISSING_ACQUISITION";

export type CapitalGainSimulation =
  | { status: "OK"; result: CapitalGainResult }
  | { status: Exclude<CapitalGainSimulationStatus, "OK">; result: null };

/**
 * Lit un montant saisi au clavier.
 *
 * Volontairement strict : seul ce que `Number` sait lire sans ambiguïté est
 * accepté. Tout le reste — chaîne vide, espaces, virgule décimale, séparateur
 * de milliers, texte — retourne `null` et non `0`. Mieux vaut redemander une
 * saisie que deviner une intention.
 */
export function parseAmountInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export type CapitalGainSimulationInput = Omit<
  CapitalGainInput,
  "salePriceEur" | "purchasePriceEur" | "purchaseDate" | "saleDate"
> & {
  /** Saisie brute du champ « prix de cession », telle quelle. */
  salePriceRaw: string | number | null | undefined;
  /** Prix de revient issu du journal (chaîne Decimal sérialisée, ou null). */
  purchasePriceEur: string | number | null | undefined;
  /** Date d'acquisition issue du journal. */
  purchaseDate: Date | string | null | undefined;
  /** Saisie brute du champ « date de cession », telle quelle. */
  saleDate: Date | string | null | undefined;
};

/**
 * Prépare et lance la simulation, ou dit pourquoi elle n'a pas lieu.
 *
 * Le prix de cession est vérifié **avant** tout appel au moteur : aucune
 * valeur par défaut ne vient combler une saisie vide en chemin.
 */
export function simulateCapitalGain(
  input: CapitalGainSimulationInput
): CapitalGainSimulation {
  const { salePriceRaw, purchasePriceEur, purchaseDate, saleDate, ...rest } = input;

  const purchasePrice = parseAmountInput(purchasePriceEur);
  const purchaseAt = purchaseDate == null ? null : new Date(purchaseDate);
  if (
    purchasePrice == null ||
    purchasePrice <= 0 ||
    purchaseAt == null ||
    Number.isNaN(purchaseAt.getTime())
  ) {
    return { status: "MISSING_ACQUISITION", result: null };
  }

  const salePrice = parseAmountInput(salePriceRaw);
  if (salePrice == null) return { status: "MISSING_SALE_PRICE", result: null };

  // Même garde que le prix : une date de cession effacée redevient `Invalid
  // Date` via `new Date("")`, qui traverserait `holdingYearsBetween` en
  // `NaN` sans jamais lever d'erreur. Pas de date par défaut (« aujourd'hui »
  // ne comble pas une saisie inconnue) : on refuse de calculer.
  const saleAt = saleDate == null ? null : new Date(saleDate);
  if (saleAt == null || Number.isNaN(saleAt.getTime())) {
    return { status: "MISSING_SALE_DATE", result: null };
  }

  return {
    status: "OK",
    result: computeCapitalGain({
      ...rest,
      salePriceEur: salePrice,
      purchasePriceEur: purchasePrice,
      purchaseDate: purchaseAt,
      saleDate: saleAt,
    }),
  };
}

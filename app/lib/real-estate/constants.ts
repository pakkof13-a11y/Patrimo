/**
 * Vocabulaire métier de l'immobilier détenu en direct.
 *
 * Séparé de `app/lib/constants.ts` : ces listes ne concernent qu'un module,
 * et les mêler aux classes d'actifs et types de plateformes rendrait le fichier
 * central illisible.
 */

/** Nature physique du bien — conditionne le rapprochement DVF. */
export const PROPERTY_TYPES = {
  MAISON: "Maison",
  APPARTEMENT: "Appartement",
  PARKING: "Parking / box",
  TERRAIN: "Terrain",
  LOCAL_COMMERCIAL: "Local commercial",
  AUTRE: "Autre",
} as const;

export type PropertyType = keyof typeof PROPERTY_TYPES;

/**
 * Types de bien pour lesquels DVF sait produire une estimation.
 *
 * Parkings, terrains et locaux commerciaux existent dans les fichiers DVF mais
 * ne se valorisent pas au mètre carré habitable : un parking n'a pas de surface
 * bâtie exploitable, un terrain se valorise au m² de terrain. Leur proposer une
 * estimation « au m² » donnerait un chiffre sans rapport avec le marché.
 */
export const DVF_ESTIMABLE_TYPES: readonly PropertyType[] = [
  "MAISON",
  "APPARTEMENT",
];

export function isDvfEstimable(propertyType: string): boolean {
  return (DVF_ESTIMABLE_TYPES as readonly string[]).includes(propertyType);
}

/** Usage du bien — porté par l'actif, pas par la plateforme. */
export const PROPERTY_USAGES = {
  RESIDENCE_PRINCIPALE: "Résidence principale",
  RESIDENCE_SECONDAIRE: "Résidence secondaire",
  LOCATIF_NU: "Locatif nu",
  LOCATIF_MEUBLE: "Locatif meublé",
  LOCATIF_SAISONNIER: "Locatif saisonnier",
  MIXTE: "Mixte",
  AUTRE: "Autre",
} as const;

export type PropertyUsage = keyof typeof PROPERTY_USAGES;

/** Usages générant un revenu locatif — pilote l'affichage du rendement. */
export const RENTAL_USAGES: readonly PropertyUsage[] = [
  "LOCATIF_NU",
  "LOCATIF_MEUBLE",
  "LOCATIF_SAISONNIER",
  "MIXTE",
];

export function isRentalUsage(usage: string): boolean {
  return (RENTAL_USAGES as readonly string[]).includes(usage);
}

/**
 * Structure de détention — portée par la **plateforme** (`Platform.subtype`),
 * comme les couches pour les blockchains.
 *
 * C'est bien un attribut de la structure et non du bien : une même SCI peut
 * détenir une résidence secondaire et un locatif, chacun avec son usage propre.
 */
export const DETENTION_STRUCTURES = {
  DIRECT: "Détention directe",
  INDIVISION: "Indivision",
  SCI: "SCI",
  DEMEMBREMENT: "Démembrement (usufruit / nue-propriété)",
} as const;

export type DetentionStructure = keyof typeof DETENTION_STRUCTURES;

/** Diagnostic de performance énergétique. */
export const ENERGY_RATINGS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type EnergyRating = (typeof ENERGY_RATINGS)[number];

/** Mode de valorisation d'un bien. */
export const VALUATION_MODES = {
  /** Réévalué automatiquement depuis DVF. */
  DVF_AUTO: "Estimation DVF automatique",
  /** Valeur fixée par l'utilisateur — jamais écrasée. */
  MANUAL: "Valeur saisie",
} as const;

export type ValuationMode = keyof typeof VALUATION_MODES;

export function propertyTypeLabel(value: string): string {
  return PROPERTY_TYPES[value as PropertyType] ?? value;
}

export function propertyUsageLabel(value: string): string {
  return PROPERTY_USAGES[value as PropertyUsage] ?? value;
}

export function detentionStructureLabel(value: string): string {
  return DETENTION_STRUCTURES[value as DetentionStructure] ?? value;
}

/**
 * Formate une quote-part de détention pour l'affichage.
 *
 * La quote-part est stockée dans la `quantity` de la position : 1 = pleine
 * propriété, 0,5 = moitié. Afficher « 0,5 » dans la colonne quantité d'un
 * tableau de positions n'a aucun sens pour un appartement — on montre donc un
 * pourcentage.
 *
 * Les décimales ne sont affichées que si elles portent de l'information : une
 * indivision par tiers donne « 33,33 % », une part de 7,5 % donne « 7,5 % » et
 * non « 7,50 % », une détention pleine donne « 100 % ».
 */
export function formatOwnershipShare(quantity: number | string): string {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return "—";
  return `${(q * 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} %`;
}

/**
 * Rendement locatif brut : loyers annuels rapportés à la valeur du bien.
 *
 * Calculé sur le bien **entier** — loyer et valeur sont tous deux exprimés à
 * 100 %. Y mêler la quote-part ne changerait pas le taux (numérateur et
 * dénominateur seraient divisés par le même facteur) mais inviterait à des
 * erreurs de rapprochement.
 *
 * `null` si la valeur est inconnue ou nulle : afficher « 0 % » laisserait croire
 * à un rendement nul là où l'on n'a simplement pas l'information.
 */
export function grossRentalYieldPct(input: {
  monthlyRentEur: number | null | undefined;
  occupancyRatePct?: number | null;
  propertyValueEur: number | null | undefined;
}): number | null {
  const rent = Number(input.monthlyRentEur ?? 0);
  const value = Number(input.propertyValueEur ?? 0);
  if (!Number.isFinite(rent) || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (rent <= 0) return null;
  // Le taux d'occupation ne s'applique qu'en saisonnier ; absent, on considère
  // le bien loué toute l'année plutôt que d'inventer une décote.
  const occupancy =
    input.occupancyRatePct == null ? 100 : Number(input.occupancyRatePct);
  const effective = Number.isFinite(occupancy)
    ? Math.min(100, Math.max(0, occupancy))
    : 100;
  return ((rent * 12 * (effective / 100)) / value) * 100;
}

/**
 * Rendement locatif net de charges et de taxe foncière, rapporté au **coût de
 * revient** (prix payé + frais d'acquisition) et non à la valeur actuelle.
 *
 * C'est le taux qui répond à « que me rapporte l'argent que j'ai engagé ». Le
 * rapporter à la valeur de marché mesurerait autre chose : la rentabilité qu'un
 * acheteur obtiendrait aujourd'hui.
 */
export function netRentalYieldPct(input: {
  monthlyRentEur: number | null | undefined;
  monthlyChargesEur?: number | null;
  annualPropertyTaxEur?: number | null;
  occupancyRatePct?: number | null;
  costBasisEur: number | null | undefined;
}): number | null {
  const rent = Number(input.monthlyRentEur ?? 0);
  const cost = Number(input.costBasisEur ?? 0);
  if (!Number.isFinite(rent) || !Number.isFinite(cost) || cost <= 0) return null;
  if (rent <= 0) return null;

  const occupancy =
    input.occupancyRatePct == null ? 100 : Number(input.occupancyRatePct);
  const effective = Number.isFinite(occupancy)
    ? Math.min(100, Math.max(0, occupancy))
    : 100;

  const annualRent = rent * 12 * (effective / 100);
  const annualCharges = Number(input.monthlyChargesEur ?? 0) * 12;
  const propertyTax = Number(input.annualPropertyTaxEur ?? 0);
  const net = annualRent - annualCharges - propertyTax;
  return (net / cost) * 100;
}

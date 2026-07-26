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

/**
 * Usage du bien — porté par l'actif, pas par la plateforme.
 *
 * L'usage décrit **ce qu'on fait du bien**, rien d'autre. Le régime fiscal et
 * le dispositif de défiscalisation sont deux dimensions distinctes, déclarées
 * plus bas : un Pinel n'est pas un usage, c'est un locatif nu assorti d'une
 * réduction d'impôt. Les fondre dans une liste unique (« RENTAL_PINEL »,
 * « RENTAL_FURNISHED »…) rendrait inexprimables les combinaisons réelles —
 * un meublé au réel avec amortissement, un nu au micro-foncier sous
 * Denormandie — et obligerait à rallonger la liste à chaque loi de finances.
 */
export const PROPERTY_USAGES = {
  RESIDENCE_PRINCIPALE: "Résidence principale",
  RESIDENCE_SECONDAIRE: "Résidence secondaire",
  LOCATIF_NU: "Locatif nu",
  LOCATIF_MEUBLE: "Locatif meublé",
  LOCATIF_SAISONNIER: "Locatif saisonnier (Airbnb, meublé de tourisme)",
  MIXTE: "Mixte (habitation + professionnel)",
  AUTRE: "Autre",
} as const;

export type PropertyUsage = keyof typeof PROPERTY_USAGES;

/**
 * Régime d'imposition des revenus locatifs.
 *
 * Le régime dépend du **mode de location** : nu → revenus fonciers,
 * meublé → BIC. Proposer un micro-foncier sur un meublé serait une erreur de
 * déclaration, d'où `regimesForUsage` qui restreint la liste.
 */
export const RENTAL_REGIMES = {
  MICRO_FONCIER: "Micro-foncier (abattement 30 %)",
  REEL_FONCIER: "Réel foncier (charges réelles, 2044)",
  MICRO_BIC: "Micro-BIC (abattement 50 %)",
  REEL_BIC: "Réel BIC (charges + amortissement)",
  LMP: "Loueur en meublé professionnel",
} as const;

export type RentalRegimeKey = keyof typeof RENTAL_REGIMES;

/** Régimes ouverts en location nue. */
export const BARE_REGIMES: readonly RentalRegimeKey[] = [
  "MICRO_FONCIER",
  "REEL_FONCIER",
];

/** Régimes ouverts en location meublée. */
export const FURNISHED_REGIMES: readonly RentalRegimeKey[] = [
  "MICRO_BIC",
  "REEL_BIC",
  "LMP",
];

/** Vrai si l'usage correspond à une location meublée. */
export function isFurnishedUsage(usage: string): boolean {
  return usage === "LOCATIF_MEUBLE" || usage === "LOCATIF_SAISONNIER";
}

/** Régimes proposables pour un usage donné. */
export function regimesForUsage(usage: string): readonly RentalRegimeKey[] {
  if (!isRentalUsage(usage)) return [];
  return isFurnishedUsage(usage) ? FURNISHED_REGIMES : BARE_REGIMES;
}

/**
 * Dispositif de défiscalisation adossé au bien.
 *
 * Orthogonal à l'usage et au régime : un Pinel reste un locatif nu déclaré
 * au foncier ; le dispositif n'ajoute qu'une réduction d'impôt conditionnée à
 * un engagement de durée. Aucun de ces dispositifs n'est calculé pour
 * l'instant — le champ sert à qualifier le bien et à porter l'échéance
 * d'engagement, que l'on ne veut pas perdre de vue.
 */
export const TAX_SCHEMES = {
  AUCUN: "Aucun",
  PINEL: "Pinel",
  PINEL_PLUS: "Pinel+ (qualité d'usage)",
  DENORMANDIE: "Denormandie (ancien à rénover)",
  MALRAUX: "Malraux (secteur sauvegardé)",
  MONUMENT_HISTORIQUE: "Monument historique",
  LOC_AVANTAGES: "Loc'Avantages (ex-Cosse)",
  CENSI_BOUVARD: "Censi-Bouvard (résidence services)",
  DEFICIT_FONCIER: "Déficit foncier",
} as const;

export type TaxScheme = keyof typeof TAX_SCHEMES;

/** Dispositifs comportant un engagement de location à durée déterminée. */
export const SCHEMES_WITH_COMMITMENT: readonly TaxScheme[] = [
  "PINEL",
  "PINEL_PLUS",
  "DENORMANDIE",
  "LOC_AVANTAGES",
  "CENSI_BOUVARD",
];

export function hasCommitment(scheme: string): boolean {
  return (SCHEMES_WITH_COMMITMENT as readonly string[]).includes(scheme);
}

export function rentalRegimeLabel(value: string): string {
  return RENTAL_REGIMES[value as RentalRegimeKey] ?? value;
}

export function taxSchemeLabel(value: string): string {
  return TAX_SCHEMES[value as TaxScheme] ?? value;
}

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

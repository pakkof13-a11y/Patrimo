/**
 * Vocabulaire des métaux précieux — sans dépendance à Prisma.
 *
 * Ce fichier est importé par les formulaires : il ne doit jamais tirer le
 * client Prisma, sous peine d'embarquer le driver `pg` dans le bundle
 * navigateur. La convention du dépôt s'applique — union TS et non enum Prisma.
 */

export const PRECIOUS_METALS = [
  "GOLD",
  "SILVER",
  "PLATINUM",
  "PALLADIUM",
  "OTHER",
] as const;
export type PreciousMetal = (typeof PRECIOUS_METALS)[number];

export const METAL_LABELS: Record<PreciousMetal, string> = {
  GOLD: "Or",
  SILVER: "Argent",
  PLATINUM: "Platine",
  PALLADIUM: "Palladium",
  OTHER: "Autre",
};

/** Code de marché, utile pour brancher un fournisseur de cours plus tard. */
export const METAL_SPOT_SYMBOLS: Record<PreciousMetal, string | null> = {
  GOLD: "XAU",
  SILVER: "XAG",
  PLATINUM: "XPT",
  PALLADIUM: "XPD",
  OTHER: null,
};

export const PRECIOUS_FORMATS = ["PHYSICAL", "PAPER"] as const;
export type PreciousFormat = (typeof PRECIOUS_FORMATS)[number];

export const FORMAT_LABELS: Record<PreciousFormat, string> = {
  PHYSICAL: "Physique",
  PAPER: "Papier",
};

export const PRODUCT_TYPES = [
  "COIN",
  "BAR",
  "JEWELRY",
  "ETC",
  "MINING",
  "OTHER",
] as const;
export type PreciousProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_TYPE_LABELS: Record<PreciousProductType, string> = {
  COIN: "Pièce",
  BAR: "Lingot / lingotin",
  JEWELRY: "Bijou",
  ETC: "ETC / ETF adossé",
  MINING: "Minière",
  OTHER: "Autre",
};

/**
 * Formats pour lesquels la fiscalité de l'article 150 VI s'applique.
 *
 * Un ETC or ou une action minière relèvent du PFU comme n'importe quel titre :
 * les traiter comme du métal physique donnerait un impôt faux, c'est pourquoi
 * le module distingue les deux au lieu de tout ranger sous « or ».
 */
export const PHYSICAL_TAX_FORMATS: readonly PreciousFormat[] = ["PHYSICAL"];

export const WEIGHT_UNITS = ["GRAM", "OZ"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const WEIGHT_UNIT_LABELS: Record<WeightUnit, string> = {
  GRAM: "Grammes (g)",
  OZ: "Onces troy (oz)",
};

/** 1 once troy = 31,1034768 g. */
export const GRAMS_PER_TROY_OZ = "31.1034768";

/**
 * Titres usuels, en millièmes.
 *
 * Un Napoléon titre 900 : ses 6,45 g pèsent 5,81 g d'or fin. Confondre poids
 * brut et poids fin surestime l'avoir en or de plus de 10 %.
 */
export const COMMON_FINENESS = [
  { label: "999,9 — lingot / lingotin", value: "999.9" },
  { label: "999 — Krugerrand argent, Maple", value: "999" },
  { label: "916,7 — 22 carats (Krugerrand, Souverain)", value: "916.7" },
  { label: "900 — Napoléon, Union latine", value: "900" },
  { label: "750 — 18 carats (bijou)", value: "750" },
] as const;

export function isPreciousMetal(value: string): value is PreciousMetal {
  return (PRECIOUS_METALS as readonly string[]).includes(value);
}

export function isPreciousFormat(value: string): value is PreciousFormat {
  return (PRECIOUS_FORMATS as readonly string[]).includes(value);
}

export function isProductType(value: string): value is PreciousProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value);
}

export function isWeightUnit(value: string): value is WeightUnit {
  return (WEIGHT_UNITS as readonly string[]).includes(value);
}

export function metalLabel(value: string): string {
  return isPreciousMetal(value) ? METAL_LABELS[value] : value;
}

export function productTypeLabel(value: string): string {
  return isProductType(value) ? PRODUCT_TYPE_LABELS[value] : value;
}

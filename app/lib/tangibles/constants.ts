/**
 * Vocabulaire des actifs tangibles — sans dépendance à Prisma.
 *
 * Importé par le formulaire : ce fichier ne doit jamais tirer le client
 * Prisma, sous peine d'embarquer le driver `pg` dans le bundle navigateur.
 * Convention du dépôt : union TS et non enum Prisma.
 */

import type { MovableNature } from "@/app/lib/tax/movable-assets";

export const TANGIBLE_CATEGORIES = [
  "WATCHES",
  "JEWELRY",
  "GEMSTONE",
  "ART",
  "WINE",
  "HANDBAG",
  "INSTRUMENT",
  "NUMISMATICS",
  "PHILATELY",
  "FURNITURE",
  "AUTO",
  "OTHER",
] as const;
export type TangibleCategory = (typeof TANGIBLE_CATEGORIES)[number];

export const TANGIBLE_CATEGORY_LABELS: Record<TangibleCategory, string> = {
  WATCHES: "Montres & horlogerie",
  JEWELRY: "Bijoux",
  GEMSTONE: "Pierres précieuses",
  ART: "Art",
  WINE: "Vins & spiritueux",
  HANDBAG: "Maroquinerie de luxe",
  INSTRUMENT: "Instruments de musique",
  NUMISMATICS: "Numismatique",
  PHILATELY: "Philatélie",
  FURNITURE: "Mobilier & antiquités",
  AUTO: "Automobiles & motos",
  OTHER: "Autre",
};

/** Pictogramme court, pour distinguer les catégories d'un coup d'œil. */
export const TANGIBLE_CATEGORY_ICONS: Record<TangibleCategory, string> = {
  WATCHES: "⌚",
  JEWELRY: "💍",
  GEMSTONE: "💎",
  ART: "🖼️",
  WINE: "🍷",
  HANDBAG: "👜",
  INSTRUMENT: "🎻",
  NUMISMATICS: "🪙",
  PHILATELY: "✉️",
  FURNITURE: "🪑",
  AUTO: "🚗",
  OTHER: "📦",
};

/**
 * Nature fiscale par défaut d'une catégorie.
 *
 * `EXEMPT_BY_NATURE` n'est pas un jugement esthétique : l'article 150 UA II 1°
 * exonère nommément les meubles meublants, l'électroménager et les
 * automobiles. Le mobilier et les véhicules partent donc exonérés, et ne
 * deviennent imposables que déclarés objets de collection — ce que le
 * formulaire demande explicitement plutôt que de le deviner.
 */
const DEFAULT_NATURE: Record<TangibleCategory, MovableNature> = {
  WATCHES: "COLLECTIBLE",
  JEWELRY: "COLLECTIBLE",
  GEMSTONE: "COLLECTIBLE",
  ART: "COLLECTIBLE",
  WINE: "COLLECTIBLE",
  HANDBAG: "COLLECTIBLE",
  INSTRUMENT: "COLLECTIBLE",
  NUMISMATICS: "COLLECTIBLE",
  PHILATELY: "COLLECTIBLE",
  FURNITURE: "EXEMPT_BY_NATURE",
  AUTO: "EXEMPT_BY_NATURE",
  OTHER: "COLLECTIBLE",
};

/** Catégories où la qualification d'objet de collection change l'impôt dû. */
export const COLLECTIBLE_TOGGLE_CATEGORIES: readonly TangibleCategory[] = [
  "FURNITURE",
  "AUTO",
];

/**
 * Nature fiscale effective d'une ligne.
 *
 * Une 2 CV de tous les jours ne supporte aucun impôt à la revente ; la même
 * voiture qualifiée de collection bascule sous l'article 150 VI. C'est le seul
 * endroit du module où ce basculement est décidé.
 */
export function fiscalNature(
  category: string,
  isCollectible: boolean
): MovableNature {
  const cat = isTangibleCategory(category) ? category : "OTHER";
  const base = DEFAULT_NATURE[cat];
  if (base === "EXEMPT_BY_NATURE" && isCollectible) return "COLLECTIBLE";
  return base;
}

export function isTangibleCategory(value: string): value is TangibleCategory {
  return (TANGIBLE_CATEGORIES as readonly string[]).includes(value);
}

export function tangibleCategoryLabel(value: string): string {
  return isTangibleCategory(value) ? TANGIBLE_CATEGORY_LABELS[value] : value;
}

// ─── Pierres ────────────────────────────────────────────────────────────────

export const GEM_TYPES = [
  "DIAMOND",
  "RUBY",
  "EMERALD",
  "SAPPHIRE",
  "PEARL",
  "OTHER",
] as const;
export type GemType = (typeof GEM_TYPES)[number];

export const GEM_TYPE_LABELS: Record<GemType, string> = {
  DIAMOND: "Diamant",
  RUBY: "Rubis",
  EMERALD: "Émeraude",
  SAPPHIRE: "Saphir",
  PEARL: "Perle",
  OTHER: "Autre",
};

/** Échelle GIA, de la plus pure à la plus incluse. */
export const GEM_CLARITIES = [
  "FL",
  "IF",
  "VVS1",
  "VVS2",
  "VS1",
  "VS2",
  "SI1",
  "SI2",
] as const;
export type GemClarity = (typeof GEM_CLARITIES)[number];

export const GEM_CUTS = [
  "ROUND",
  "PRINCESS",
  "OVAL",
  "PEAR",
  "CUSHION",
  "EMERALD_CUT",
  "OTHER",
] as const;
export type GemCut = (typeof GEM_CUTS)[number];

export const GEM_CUT_LABELS: Record<GemCut, string> = {
  ROUND: "Rond brillant",
  PRINCESS: "Princesse",
  OVAL: "Ovale",
  PEAR: "Poire",
  CUSHION: "Coussin",
  EMERALD_CUT: "Émeraude",
  OTHER: "Autre",
};

/**
 * Traitement subi par la pierre.
 *
 * Ce n'est pas un détail de catalogue : une pierre chauffée ou synthétique
 * vaut une fraction de l'équivalent naturel non traité, et l'écart se compte
 * en ordres de grandeur sur les rubis et saphirs.
 */
export const GEM_TREATMENTS = [
  "NONE",
  "HEATED",
  "FRACTURE_FILLED",
  "SYNTHETIC",
] as const;
export type GemTreatment = (typeof GEM_TREATMENTS)[number];

export const GEM_TREATMENT_LABELS: Record<GemTreatment, string> = {
  NONE: "Aucun (naturelle non traitée)",
  HEATED: "Chauffée",
  FRACTURE_FILLED: "Fractures comblées",
  SYNTHETIC: "Synthétique",
};

// ─── Bijoux ─────────────────────────────────────────────────────────────────

export const JEWELRY_TYPES = [
  "RING",
  "NECKLACE",
  "BRACELET",
  "EARRINGS",
  "BROOCH",
  "OTHER",
] as const;
export type JewelryType = (typeof JEWELRY_TYPES)[number];

export const JEWELRY_TYPE_LABELS: Record<JewelryType, string> = {
  RING: "Bague",
  NECKLACE: "Collier",
  BRACELET: "Bracelet",
  EARRINGS: "Boucles d'oreilles",
  BROOCH: "Broche",
  OTHER: "Autre",
};

export const METAL_BASES = [
  "GOLD_750",
  "GOLD_585",
  "SILVER_925",
  "PLATINUM_950",
] as const;
export type MetalBase = (typeof METAL_BASES)[number];

export const METAL_BASE_LABELS: Record<MetalBase, string> = {
  GOLD_750: "Or 750 ‰ (18 carats)",
  GOLD_585: "Or 585 ‰ (14 carats)",
  SILVER_925: "Argent 925 ‰",
  PLATINUM_950: "Platine 950 ‰",
};

// ─── Horlogerie ─────────────────────────────────────────────────────────────

export const WATCH_MOVEMENTS = ["AUTOMATIC", "MANUAL", "QUARTZ", "SOLAR"] as const;
export type WatchMovement = (typeof WATCH_MOVEMENTS)[number];

export const WATCH_MOVEMENT_LABELS: Record<WatchMovement, string> = {
  AUTOMATIC: "Automatique",
  MANUAL: "Manuel",
  QUARTZ: "Quartz",
  SOLAR: "Solaire",
};

// ─── Vins ───────────────────────────────────────────────────────────────────

export const WINE_BOTTLE_FORMATS = [
  "BOTTLE_75",
  "MAGNUM",
  "JEROBOAM",
  "OTHER",
] as const;
export type WineBottleFormat = (typeof WINE_BOTTLE_FORMATS)[number];

export const WINE_BOTTLE_FORMAT_LABELS: Record<WineBottleFormat, string> = {
  BOTTLE_75: "Bouteille (75 cl)",
  MAGNUM: "Magnum (1,5 L)",
  JEROBOAM: "Jéroboam (3 L)",
  OTHER: "Autre",
};

export const WINE_STORAGE_TYPES = ["CAVE_PERSO", "CAVE_LOUEE", "COURTIER"] as const;
export type WineStorageType = (typeof WINE_STORAGE_TYPES)[number];

export const WINE_STORAGE_TYPE_LABELS: Record<WineStorageType, string> = {
  CAVE_PERSO: "Cave personnelle",
  CAVE_LOUEE: "Cave louée",
  COURTIER: "Chez un courtier / négociant",
};

/** Champs spécifiques affichés à l'étape 2 du formulaire, par catégorie. */
export const CATEGORY_DETAIL_FIELDS: Partial<
  Record<TangibleCategory, readonly string[]>
> = {
  JEWELRY: ["jewelry", "gem"],
  GEMSTONE: ["gem"],
  WATCHES: ["watch"],
  WINE: ["wine"],
  AUTO: ["auto"],
};

export function detailSectionsFor(category: string): readonly string[] {
  return isTangibleCategory(category)
    ? (CATEGORY_DETAIL_FIELDS[category] ?? [])
    : [];
}

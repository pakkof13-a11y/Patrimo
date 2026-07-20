/**
 * Options combobox : plateformes utilisateur + catalogue (logos).
 * Présentation : nom · catégorie principale · sous-titre optionnel.
 * Pas de wording interne « Catalogue ».
 */

import { PLATFORM_TYPES } from "@/app/lib/constants";
import {
  PLATFORM_PRESETS,
  matchesPlatformLabelPrefix,
  primaryType,
  type PlatformPreset,
} from "@/app/lib/platforms/presets";

/** Préfixe des values catalogue (≠ cuid plateforme). */
export const CATALOG_VALUE_PREFIX = "catalog:";

export type PlatformPickOption = {
  value: string;
  /** Ligne 1 — nom affiché */
  label: string;
  /** Ligne 2 — catégorie principale (Courtier, Banque, Exchange crypto…) */
  categoryLabel?: string;
  /**
   * Ligne 3 — sous-titre descriptif optionnel (sous-catégorie métier).
   * Ne pas y mettre de tags techniques.
   */
  description?: string;
  /**
   * @deprecated Préférer categoryLabel + description.
   * Conservé pour compat : = categoryLabel (sans « Catalogue »).
   */
  subtitle?: string;
  logoUrl?: string | null;
  isNew?: boolean;
  /** Suggestion catalogue (pas encore une plateforme user) */
  isCatalog?: boolean;
  preset?: PlatformPreset;
};

export function catalogValue(key: string): string {
  return `${CATALOG_VALUE_PREFIX}${key}`;
}

export function isCatalogValue(value: string): boolean {
  return value.startsWith(CATALOG_VALUE_PREFIX);
}

export function catalogKeyFromValue(value: string): string | null {
  if (!isCatalogValue(value)) return null;
  return value.slice(CATALOG_VALUE_PREFIX.length) || null;
}

export function categoryLabelForType(type: string): string {
  return PLATFORM_TYPES[type as keyof typeof PLATFORM_TYPES] || type;
}

export function categoryLabelForPreset(p: PlatformPreset): string {
  // Crypto : category métier (CEX / DEX / CeDeFi) si renseignée
  if (
    p.types.includes("EXCHANGE_CRYPTO") &&
    p.category &&
    p.category !== "Exchanges crypto"
  ) {
    return p.category;
  }
  if (p.category === "Exchanges crypto") return "Exchange crypto";
  return categoryLabelForType(primaryType(p));
}

/** Sous-titre utile (subtype AV / Layer blockchain / CEX…) — pas de tags techniques. */
export function descriptionForPreset(p: PlatformPreset): string | undefined {
  if (p.subtype?.trim()) return p.subtype.trim();
  return undefined;
}

/**
 * Filtre options combobox : prefix strict sur le libellé affiché.
 * @see matchesPlatformLabelPrefix
 */
export function filterPlatformPickOptions(
  options: PlatformPickOption[],
  query: string
): PlatformPickOption[] {
  const q = query.trim();
  if (!q) {
    const owned = options.filter((o) => !o.isCatalog);
    const catalog = options.filter((o) => o.isCatalog);
    return [...owned, ...catalog].slice(0, 60);
  }
  return options
    .filter((o) => matchesPlatformLabelPrefix(o.label, q))
    .slice(0, 40);
}

/**
 * Fusionne les plateformes user (déjà triées) + presets non encore possédés.
 */
export function buildPlatformPickOptions(params: {
  platforms: Array<{
    id: string;
    name: string;
    type: string;
    subtype?: string | null;
    logoUrl?: string | null;
    logoKey?: string | null;
  }>;
  newPlatformIds?: Set<string>;
  /** Inclure le catalogue de courtiers connus (défaut true). */
  includeCatalog?: boolean;
}): PlatformPickOption[] {
  const includeCatalog = params.includeCatalog !== false;
  const newIds = params.newPlatformIds ?? new Set<string>();

  const ownedKeys = new Set(
    params.platforms
      .map((p) => (p.logoKey || "").toUpperCase())
      .filter(Boolean)
  );
  const ownedNames = new Set(
    params.platforms.map((p) => p.name.trim().toLowerCase())
  );

  const owned: PlatformPickOption[] = params.platforms.map((p) => {
    const cat = categoryLabelForType(p.type);
    return {
      value: p.id,
      label: p.name,
      categoryLabel: cat,
      description: p.subtype?.trim() || undefined,
      subtitle: cat,
      logoUrl: p.logoUrl,
      isNew: newIds.has(p.id),
      isCatalog: false,
    };
  });

  if (!includeCatalog) return owned;

  const catalog: PlatformPickOption[] = [];
  for (const preset of PLATFORM_PRESETS) {
    if (ownedKeys.has(preset.key.toUpperCase())) continue;
    if (ownedNames.has(preset.name.trim().toLowerCase())) continue;
    const shortName = preset.name.split("(")[0]?.trim().toLowerCase() || "";
    if (shortName && ownedNames.has(shortName)) continue;

    const cat = categoryLabelForPreset(preset);
    const desc = descriptionForPreset(preset);
    catalog.push({
      value: catalogValue(preset.key),
      label: preset.name,
      categoryLabel: cat,
      description: desc,
      subtitle: cat,
      logoUrl: preset.logoUrl,
      isCatalog: true,
      preset,
    });
  }

  return [...owned, ...catalog];
}

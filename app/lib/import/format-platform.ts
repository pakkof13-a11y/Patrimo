/**
 * Lien format CSV pré-construit → plateforme catalogue par défaut.
 * Dès qu’un export IBKR / Coinbase / … est détecté (ou choisi), la destination
 * d’import peut se préremplir automatiquement.
 */

import type { ImportFormatId } from "./presets";

export type FormatPlatformHint = {
  logoKey: string;
  name: string;
};

/** Formats broker/exchange → clé catalogue + libellé. */
export const FORMAT_DEFAULT_PLATFORM: Partial<
  Record<ImportFormatId, FormatPlatformHint>
> = {
  interactive_brokers: {
    logoKey: "INTERACTIVE_BROKERS",
    name: "Interactive Brokers",
  },
  avanza: { logoKey: "AVANZA", name: "Avanza" },
  binance: { logoKey: "BINANCE", name: "Binance" },
  bitvavo: { logoKey: "BITVAVO", name: "Bitvavo" },
  bux: { logoKey: "BUX", name: "BUX" },
  degiro: { logoKey: "DEGIRO", name: "DEGIRO" },
  directa: { logoKey: "DIRECTA", name: "Directa" },
  etoro: { logoKey: "ETORO", name: "eToro" },
  saxo: { logoKey: "SAXO_BANK", name: "Saxo Bank" },
  swissquote: { logoKey: "SWISSQUOTE", name: "Swissquote" },
  trading212: { logoKey: "TRADING_212", name: "Trading 212" },
  xtb: { logoKey: "XTB", name: "XTB" },
  coinbase: { logoKey: "COINBASE", name: "Coinbase" },
  boursorama: { logoKey: "BOURSOBANK", name: "BoursoBank" },
  fortuneo: { logoKey: "FORTUNEO", name: "Fortuneo" },
  trade_republic: { logoKey: "TRADE_REPUBLIC", name: "Trade Republic" },
  revolut: { logoKey: "REVOLUT", name: "Revolut" },
  cryptocom: { logoKey: "CRYPTO_COM", name: "Crypto.com" },
  cryptocom_transfer: { logoKey: "CRYPTO_COM", name: "Crypto.com" },
  bitpanda: { logoKey: "BITPANDA", name: "Bitpanda" },
  bybit: { logoKey: "BYBIT", name: "Bybit" },
  revolut_crypto: { logoKey: "REVOLUT", name: "Revolut" },
  nexo: { logoKey: "NEXO", name: "Nexo" },
  ascendex: { logoKey: "ASCENDEX", name: "AscendEX" },
  ledger_live: { logoKey: "LEDGER", name: "Ledger" },
  /*
    Deux formats, une plateforme.

    `hyperliquid_trade` et `hyperliquid_funding` décrivent deux exports du même
    compte : les rattacher tous deux à la même destination est ce qui distingue
    un format d'une plateforme. Ils restent techniquement séparés — leurs
    adaptateurs ne lisent pas les mêmes colonnes.
  */
  hyperliquid_trade: { logoKey: "HYPERLIQUID", name: "Hyperliquid" },
  hyperliquid_funding: { logoKey: "HYPERLIQUID", name: "Hyperliquid" },
  paradex: { logoKey: "PARADEX", name: "Paradex" },
  // patrimo / generic / dynamic → pas de plateforme forcée
};

/**
 * Formats d'import dédiés à une plateforme du catalogue.
 *
 * Lecture inverse de `FORMAT_DEFAULT_PLATFORM` : une plateforme peut en avoir
 * plusieurs — Crypto.com en a deux, Hyperliquid aussi — comme elle peut n'en
 * avoir aucun.
 *
 * Le tableau vide est le cas le plus courant et le plus important : figurer au
 * catalogue veut dire « on peut y détenir des actifs », pas « on sait lire son
 * export ». Les deux questions sont distinctes, et l'écran d'import doit
 * pouvoir dire laquelle il ne sait pas encore résoudre.
 */
export function formatsForPlatform(
  logoKey: string | null | undefined
): ImportFormatId[] {
  if (!logoKey) return [];
  const key = logoKey.toUpperCase();
  return (
    Object.entries(FORMAT_DEFAULT_PLATFORM) as Array<
      [ImportFormatId, FormatPlatformHint]
    >
  )
    .filter(([, hint]) => hint.logoKey.toUpperCase() === key)
    .map(([id]) => id);
}

/**
 * Cette plateforme dispose-t-elle d'un format d'import dédié ?
 *
 * `false` ne signifie pas « import impossible » : le mapping générique et la
 * détection dynamique restent disponibles pour n'importe quel CSV. Cela
 * signifie qu'aucun parser ne connaît la structure de ce fichier, et que
 * l'utilisateur devra désigner les colonnes lui-même.
 */
export function hasDedicatedFormat(logoKey: string | null | undefined): boolean {
  return formatsForPlatform(logoKey).length > 0;
}

export function platformHintForFormat(
  formatId: ImportFormatId | string | null | undefined
): FormatPlatformHint | null {
  if (!formatId || formatId === "auto" || formatId === "generic") return null;
  if (formatId === "patrimo" || formatId === "dynamic") return null;
  return FORMAT_DEFAULT_PLATFORM[formatId as ImportFormatId] ?? null;
}

/**
 * Résout une option plateforme existante (user ou catalogue) pour un format.
 * Préfère une plateforme déjà créée (même logoKey / nom).
 */
export function resolvePlatformOptionForFormat(
  formatId: ImportFormatId | string | null | undefined,
  options: Array<{
    value: string;
    label: string;
    isCatalog?: boolean;
    logoUrl?: string | null;
    preset?: { key?: string; name?: string } | null;
  }>
): {
  value: string;
  label: string;
  isCatalog?: boolean;
  logoUrl?: string | null;
  preset?: { key?: string; name?: string } | null;
} | null {
  const hint = platformHintForFormat(formatId);
  if (!hint) return null;

  const keyNorm = hint.logoKey.toUpperCase();
  const nameNorm = hint.name.toLowerCase();

  // 1) Plateforme utilisateur déjà en portefeuille
  const userHit = options.find((o) => {
    if (o.isCatalog) return false;
    const presetKey = (o.preset?.key || "").toUpperCase();
    const label = o.label.toLowerCase();
    return (
      presetKey === keyNorm ||
      label === nameNorm ||
      label.includes(nameNorm) ||
      nameNorm.includes(label)
    );
  });
  if (userHit) return userHit;

  // 2) Catalogue (création auto possible)
  const catalogHit = options.find((o) => {
    if (!o.isCatalog && !String(o.value).startsWith("catalog:")) return false;
    const presetKey = (o.preset?.key || "").toUpperCase();
    const fromValue = String(o.value)
      .replace(/^catalog:/i, "")
      .toUpperCase();
    const label = o.label.toLowerCase();
    return (
      presetKey === keyNorm ||
      fromValue === keyNorm ||
      label === nameNorm ||
      label.includes(nameNorm)
    );
  });
  if (catalogHit) return catalogHit;

  // 3) Fallback synthétique catalogue
  return {
    value: `catalog:${hint.logoKey}`,
    label: hint.name,
    isCatalog: true,
    preset: { key: hint.logoKey, name: hint.name },
  };
}

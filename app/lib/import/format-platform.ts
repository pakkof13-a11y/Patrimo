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
  binance: { logoKey: "BINANCE", name: "Binance" },
  coinbase: { logoKey: "COINBASE", name: "Coinbase" },
  boursorama: { logoKey: "BOURSOBANK", name: "BoursoBank" },
  fortuneo: { logoKey: "FORTUNEO", name: "Fortuneo" },
  trade_republic: { logoKey: "TRADE_REPUBLIC", name: "Trade Republic" },
  revolut: { logoKey: "REVOLUT", name: "Revolut" },
  cryptocom: { logoKey: "CRYPTO_COM", name: "Crypto.com" },
  cryptocom_transfer: { logoKey: "CRYPTO_COM", name: "Crypto.com" },
  nexo: { logoKey: "NEXO", name: "Nexo" },
  ascendex: { logoKey: "ASCENDEX", name: "AscendEX" },
  ledger_live: { logoKey: "LEDGER", name: "Ledger" },
  // patrimo / generic / dynamic → pas de plateforme forcée
};

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

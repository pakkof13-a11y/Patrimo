export type SupportedCurrency = "EUR" | "USD" | "CHF" | "GBP" | "JPY";

export type CurrencyMeta = {
  code: SupportedCurrency | string;
  name: string;
  symbol: string;
  /** Flag emoji used as compact icon */
  flag: string;
  /** SVG-friendly circle color */
  color: string;
};

export const CURRENCIES: Record<string, CurrencyMeta> = {
  EUR: { code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺", color: "#003399" },
  USD: { code: "USD", name: "US Dollar", symbol: "$", flag: "🇺🇸", color: "#85bb65" },
  CHF: { code: "CHF", name: "Swiss Franc", symbol: "Fr.", flag: "🇨🇭", color: "#d52b1e" },
  GBP: { code: "GBP", name: "British Pound", symbol: "£", flag: "🇬🇧", color: "#00247d" },
  JPY: { code: "JPY", name: "Japanese Yen", symbol: "¥", flag: "🇯🇵", color: "#bc002d" },
};

/** Devise de reporting globale (header) — mêmes devises que les comptes */
export const BASE_CURRENCY_OPTIONS = ["EUR", "USD", "CHF", "GBP", "JPY"] as const;

/** Currencies available for bank current accounts and savings livrets */
export const ACCOUNT_CURRENCY_OPTIONS = ["EUR", "USD", "CHF", "GBP", "JPY"] as const;

export function getCurrency(code: string): CurrencyMeta {
  const c = code.toUpperCase();
  return (
    CURRENCIES[c] ?? {
      code: c,
      name: c,
      symbol: c,
      flag: "💱",
      color: "#64748b",
    }
  );
}

/** Label for currency selectors: "EUR (€)", "USD ($)", … */
export function currencyLabel(code: string): string {
  const c = getCurrency(code);
  return `${c.code} (${c.symbol})`;
}

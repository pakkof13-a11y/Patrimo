import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";

const ACCOUNT_TYPE_SET = new Set<string>(Object.keys(ACCOUNT_TYPES));

/** Vrai si la valeur est une enveloppe connue (CTO, PEA, …). */
export function isAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPE_SET.has(value);
}

/**
 * Normalise une enveloppe DB / API → AccountType.
 * Valeurs inconnues / vides → fallback (défaut CTO).
 */
export function asAccountType(
  value: string | null | undefined,
  fallback: AccountType = "CTO"
): AccountType {
  if (value && isAccountType(value)) return value;
  return fallback;
}

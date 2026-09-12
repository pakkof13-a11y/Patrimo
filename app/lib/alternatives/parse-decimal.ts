/**
 * Parsing de nombres saisis pour les modules alternatifs (métaux, tangibles,
 * crowdlending, private equity).
 *
 * Remplace les anciennes copies locales `.replace(",", ".")` — qui ne
 * géraient ni les séparateurs de milliers, ni les symboles monétaires, ni le
 * format anglo-saxon — par le parseur partagé de l'import CSV
 * (`app/lib/import/normalize.ts`), déjà robuste à ces cas.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { parseNumber } from "@/app/lib/import/normalize";

/**
 * Nombre saisi (FR « 45 000,00 », EN « 45,000.00 »…) → `Prisma.Decimal`.
 *
 * Repli silencieux sur `fallback` uniquement quand la valeur est absente ou
 * non interprétable — jamais d'interpolation, jamais de troncature partielle
 * d'un nombre par ailleurs valide.
 */
export function decFromInput(
  value: string | number | { toString(): string } | null | undefined,
  fallback = "0"
): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(fallback);
  const parsed = parseNumber(String(value));
  return new Prisma.Decimal(parsed !== null ? parsed : fallback);
}

/**
 * Entier saisi → nombre arrondi, `null` si vide ou non interprétable.
 *
 * `null` et non `0` : un champ optionnel absent (nombre de bouteilles,
 * kilométrage…) n'est pas la même chose qu'un zéro saisi.
 */
export function intFromInput(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = parseNumber(String(value));
  return parsed !== null ? Math.round(parsed) : null;
}

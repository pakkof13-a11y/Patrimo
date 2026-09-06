/**
 * Jour civil `YYYY-MM-DD` — parseur sans dépendance serveur.
 *
 * Isolé de `get-daily-nav.ts` : ce dernier charge Prisma via `load.ts`,
 * et un import de valeur depuis un composant client y entraînerait `pg`
 * dans le bundle navigateur.
 */

import type { DayKey } from "./types";

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDayKey(raw: string | null | undefined): DayKey | null {
  if (!raw || !DAY_KEY_RE.test(raw)) return null;
  return raw;
}

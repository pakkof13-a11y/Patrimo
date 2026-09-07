/**
 * Jour civil `YYYY-MM-DD` — parseur sans dépendance serveur.
 *
 * Isolé de `get-daily-nav.ts` : ce dernier charge Prisma via `load.ts`,
 * et un import de valeur depuis un composant client y entraînerait `pg`
 * dans le bundle navigateur.
 */

import type { DayKey } from "./types";

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` de forme valide **et** de date calendaire réelle.
 *
 * La forme seule ne suffit pas : `2026-02-30` ou `2026-13-45` passent la
 * regex puis `Date.UTC` les glisse silencieusement vers une autre date (2 ou
 * 3 mars, janvier de l'année suivante…) — la fenêtre servie n'est alors plus
 * celle demandée, et la chaîne d'origine, renvoyée telle quelle dans la
 * réponse, affiche une date qui n'existe pas. Le round-trip par
 * `Date.UTC` → relecture des composantes détecte ce débordement : `getUTCDate`
 * etc. ne peuvent reproduire l'entrée que si elle était une date réelle.
 */
export function parseDayKey(raw: string | null | undefined): DayKey | null {
  if (!raw) return null;
  const match = DAY_KEY_RE.exec(raw);
  if (!match) return null;
  const [, y, m, dd] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(dd);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return raw;
}

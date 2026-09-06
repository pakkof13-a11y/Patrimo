/**
 * Enveloppe API D14.2 — répartition par endroit.
 *
 * Aucune seconde formule de valorisation : on appelle `allocationByVenue` /
 * `computeAllocationByVenue` (D14.1) puis on projette le contrat Front
 * `{ venues, help, total, asOf }`. Les % Hamilton restent ceux du module
 * (`allocatePercents`, déjà utilisé par D14.1).
 *
 * `lifeInsurance` n'est pas relu ici : D14.1 l'ignore déjà (`av` = holdings
 * AV + envelopeCash AV).
 */

import {
  ALLOCATION_BY_VENUE_HELP,
  VENUE_COLORS,
  VENUE_LABELS,
  allocationByVenue,
  type AllocationByVenue,
  type VenueKey,
} from "./allocation-by-venue";

export type AllocationByVenueApiVenue = {
  id: VenueKey;
  label: string;
  amountEur: number;
  pct: number;
  color: string;
};

export type AllocationByVenueApi = {
  venues: AllocationByVenueApiVenue[];
  help: typeof ALLOCATION_BY_VENUE_HELP;
  total: number;
  asOf: string;
};

/**
 * Projette le résultat D14.1 vers le contrat API.
 *
 * - `id` = VenueKey (`slices[].key`)
 * - `label` / `color` relus depuis `VENUE_LABELS` / `VENUE_COLORS` (hex PDF)
 * - parts à 0 omises (défense : D14.1 ne les émet déjà pas)
 * - `pct` = `percent` Hamilton déjà calculé — pas de second algorithme
 * - `help` = export exact `ALLOCATION_BY_VENUE_HELP`
 */
export function toAllocationByVenueApi(
  result: AllocationByVenue
): AllocationByVenueApi {
  return {
    venues: result.slices
      .filter((s) => s.amount > 0)
      .map((s) => ({
        id: s.key,
        label: VENUE_LABELS[s.key],
        amountEur: s.amount,
        pct: s.percent,
        color: VENUE_COLORS[s.key],
      })),
    help: ALLOCATION_BY_VENUE_HELP,
    total: result.total,
    asOf: result.asOf,
  };
}

/** Charge le patrimoine via D14.1 puis projette le contrat API. */
export async function getAllocationByVenueApi(
  userId: string
): Promise<AllocationByVenueApi> {
  return toAllocationByVenueApi(await allocationByVenue(userId));
}

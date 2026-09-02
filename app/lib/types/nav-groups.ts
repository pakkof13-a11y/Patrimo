/**
 * Sélecteur d'enveloppe de la page Positions.
 *
 * Ce fichier portait aussi un `NAV_GROUPS` décrivant une barre latérale à dix
 * groupes — que rien ne rendait : `app-sidebar.tsx` déclare sa propre
 * structure. Deux descriptions concurrentes de la navigation, dont une morte,
 * ne pouvaient que tromper le prochain lecteur.
 */

import type { MainTab } from "./ui";

/** Options sélecteur d'enveloppe (page Positions). */
export const ENVELOPE_SELECT_OPTIONS: {
  value: "" | "CTO" | "PEA" | "AV" | "CRYPTO" | "IMMOBILIER" | "CFD";
  label: string;
  tab: MainTab;
  param: string;
}[] = [
  { value: "", label: "Toutes les enveloppes", tab: "holdings", param: "" },
  { value: "AV", label: "Assurance-vie", tab: "av", param: "av" },
  // Pas d'entrée IMMOBILIER, CRYPTO, CTO ni PEA : toutes ont leur onglet de
  // premier niveau. Les laisser ici ferait quitter la page Positions depuis un
  // sélecteur censé n'en filtrer que le tableau.
  { value: "CFD", label: "CFD", tab: "cfd", param: "cfd" },
];

export function envelopeParamToTab(param: string | null | undefined): MainTab {
  const p = (param || "").toLowerCase();
  const hit = ENVELOPE_SELECT_OPTIONS.find((o) => o.param === p);
  return hit?.tab ?? "holdings";
}

export function tabToEnvelopeParam(tab: MainTab): string {
  const hit = ENVELOPE_SELECT_OPTIONS.find((o) => o.tab === tab);
  return hit?.param ?? "";
}

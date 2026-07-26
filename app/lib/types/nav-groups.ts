/**
 * Navigation conceptuelle regroupée (UX) — mappe vers les MainTab existants.
 * Pas de fausses pages : seuls les onglets réellement implémentés apparaissent.
 */

import type { MainTab } from "./ui";

export type NavItem = {
  id: MainTab;
  label: string;
  /** data-testid suffix (nav-{testId}) */
  testId?: string;
};

export type NavGroup = {
  id: string;
  label: string;
  /** Si un seul item, clic direct sans menu */
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Vue d'ensemble",
    items: [{ id: "dashboard", label: "Tableau de bord", testId: "dashboard" }],
  },
  {
    id: "portfolio",
    label: "Portefeuille",
    items: [{ id: "holdings", label: "Positions", testId: "holdings" }],
  },
  {
    // Entrée directe et non un sous-menu de « Patrimoine étendu » : un bien
    // porte un usage, un régime, un dispositif, un bail et une dette. C'est
    // une catégorie à part entière, au même rang que Positions.
    id: "real-estate",
    label: "Immobilier",
    items: [{ id: "immobilier", label: "Immobilier", testId: "immobilier" }],
  },
  {
    id: "sources",
    label: "Sources",
    items: [
      { id: "banques", label: "Banques", testId: "banques" },
      {
        id: "assurance-vie",
        label: "Assurance-vie",
        testId: "assurance-vie",
      },
      { id: "platforms", label: "Mes plateformes", testId: "platforms" },
    ],
  },
  {
    id: "operations",
    label: "Opérations",
    items: [{ id: "transactions", label: "Transactions", testId: "transactions" }],
  },
  {
    id: "extended",
    label: "Patrimoine étendu",
    items: [
      { id: "epargne-salariale", label: "Épargne salariale", testId: "epargne-salariale" },
      { id: "alternatifs", label: "Actifs alternatifs", testId: "alternatifs" },
      { id: "liabilities", label: "Passifs", testId: "liabilities" },
    ],
  },
  {
    id: "tax",
    label: "Fiscalité",
    items: [{ id: "fiscal", label: "Fiscalité", testId: "fiscal" }],
  },
];

/** Options sélecteur d'enveloppe (page Positions). */
export const ENVELOPE_SELECT_OPTIONS: {
  value: "" | "CTO" | "PEA" | "AV" | "CRYPTO" | "IMMOBILIER" | "CFD";
  label: string;
  tab: MainTab;
  param: string;
}[] = [
  { value: "", label: "Toutes les enveloppes", tab: "holdings", param: "" },
  { value: "CTO", label: "Compte-titres", tab: "cto", param: "cto" },
  { value: "PEA", label: "PEA", tab: "pea", param: "pea" },
  { value: "AV", label: "Assurance-vie", tab: "av", param: "av" },
  { value: "CRYPTO", label: "Cryptomonnaies", tab: "crypto", param: "crypto" },
  // Pas d'entrée IMMOBILIER : l'immobilier a son onglet de premier niveau.
  // La laisser ici ferait quitter la page Positions depuis un sélecteur censé
  // n'en filtrer que le tableau.
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

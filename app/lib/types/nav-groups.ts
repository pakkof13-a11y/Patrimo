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
    items: [{ id: "holdings", label: "Portefeuille", testId: "holdings" }],
  },
  {
    // Même raisonnement que l'immobilier et la crypto : un PEA porte une date
    // d'ouverture, un plafond de versement et un régime d'imposition propre —
    // une vente interne n'y est pas un fait générateur, seul le retrait l'est.
    // Le tableau Positions filtré n'en montrait que la valeur.
    id: "securities",
    label: "PEA & CTO",
    items: [{ id: "securities", label: "PEA & CTO", testId: "securities" }],
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
    // Même raisonnement que l'immobilier : trois sous-catégories d'actifs
    // détenus (comptant, DeFi, NFT), une vue d'ensemble propre, des flux de
    // saisie dédiés — ce n'est plus un simple filtre d'enveloppe sur le
    // tableau Positions. Les futures sont partis dans l'onglet Trading : un
    // pari à levier n'est pas un actif détenu.
    id: "cryptos",
    label: "Cryptos",
    items: [{ id: "crypto", label: "Cryptos", testId: "crypto" }],
  },
  {
    // « Sources » ne disait pas de quoi : ni un débutant ni un initié n'y
    // devinait des banques et des contrats. Le libellé nomme désormais ce que
    // le groupe contient réellement — des comptes et des contrats.
    id: "sources",
    label: "Comptes & contrats",
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
    items: [{ id: "transactions", label: "Opérations", testId: "transactions" }],
  },
  {
    // Entrée de premier niveau : les positions à levier ne se valorisent pas
    // comme un actif détenu (marge + P&L latent, pas quantité × prix), elles
    // ne peuvent donc pas vivre sous « Patrimoine étendu » à côté de poches
    // qui, elles, s'additionnent au patrimoine net.
    id: "trading",
    label: "Trading",
    items: [{ id: "trading", label: "Trading", testId: "trading" }],
  },
  {
    // « Patrimoine étendu » rangeait les dettes parmi les avoirs, ce qui est
    // faux : un passif se soustrait du patrimoine net. Le libellé assume les
    // deux natures au lieu de les confondre.
    id: "extended",
    label: "Autres avoirs & dettes",
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

/**
 * Sections de l'espace de travail d'un actif.
 *
 * Le registre est déclaratif et **pur** : il dit quelles sections existent,
 * dans quel ordre, et lesquelles s'appliquent à un actif donné. Le composant
 * se contente de le parcourir. Une section ajoutée demain n'oblige donc pas à
 * rouvrir la barre d'onglets.
 *
 * `backing` dit d'où vient la donnée, et c'est la seule chose qui autorise une
 * section à s'afficher sans rien montrer de faux :
 *
 * - `"data"`   — le back-end sert déjà cette section.
 * - `"pending"`— l'écran est construit, le modèle de données n'existe pas
 *                encore. La section affiche explicitement ce qu'elle attend au
 *                lieu de simuler un contenu. Aucun chiffre n'y est inventé.
 */

export type AssetWorkspaceSectionId =
  | "overview"
  | "performance"
  | "transactions"
  | "platforms"
  | "costBasis"
  | "income"
  | "tax"
  | "defi"
  | "nfts"
  | "news"
  | "documents";

export type AssetWorkspaceSection = {
  id: AssetWorkspaceSectionId;
  label: string;
  /** Phrase affichée en tête de section — ce qu'elle répond, pas ce qu'elle est. */
  hint: string;
  backing: "data" | "pending";
  /** Réservée aux actifs détenus en chaîne (DeFi, NFT). */
  cryptoOnly?: boolean;
};

export const ASSET_WORKSPACE_SECTIONS: AssetWorkspaceSection[] = [
  {
    id: "overview",
    label: "Vue d'ensemble",
    hint: "Ce que vous détenez, ce que ça vaut, où ça en est",
    backing: "data",
  },
  {
    id: "performance",
    label: "Performance",
    hint: "Cours, historique et rendement de la position",
    backing: "data",
  },
  {
    id: "transactions",
    label: "Transactions",
    hint: "Le journal complet de cet actif",
    backing: "data",
  },
  {
    id: "platforms",
    label: "Plateformes",
    hint: "Où l'actif est déposé, et en quelle proportion",
    backing: "data",
  },
  {
    id: "costBasis",
    label: "PRU & P&L",
    hint: "Prix de revient, frais, et d'où vient la plus-value",
    backing: "data",
  },
  {
    id: "income",
    label: "Revenus",
    hint: "Dividendes, coupons, loyers et récompenses encaissés",
    backing: "data",
  },
  {
    id: "tax",
    label: "Fiscalité",
    hint: "Régime applicable et retenue à la source",
    backing: "pending",
  },
  {
    id: "defi",
    label: "DeFi",
    hint: "Positions de protocole ouvertes sur les mêmes adresses",
    backing: "data",
    cryptoOnly: true,
  },
  {
    id: "nfts",
    label: "NFT",
    hint: "NFT détenus sur les mêmes adresses",
    backing: "data",
    cryptoOnly: true,
  },
  {
    id: "news",
    label: "Actualités",
    hint: "Ce qui se dit sur cet actif",
    backing: "data",
  },
  {
    id: "documents",
    label: "Documents",
    hint: "IFU, relevés et justificatifs rattachés à cet actif",
    backing: "pending",
  },
];

/**
 * Sections applicables à un actif. Une section réservée à la crypto ne
 * s'affiche pas ailleurs : un onglet « NFT » vide sur une action ne dit pas
 * « vous n'en avez pas », il dit « cet écran ne me connaît pas ».
 */
export function sectionsForAsset(opts: {
  assetClass: string | null | undefined;
}): AssetWorkspaceSection[] {
  const isCrypto = (opts.assetClass || "").toUpperCase() === "CRYPTO";
  return ASSET_WORKSPACE_SECTIONS.filter((s) => !s.cryptoOnly || isCrypto);
}

export function isAssetWorkspaceSection(
  v: string | null | undefined
): v is AssetWorkspaceSectionId {
  return ASSET_WORKSPACE_SECTIONS.some((s) => s.id === v);
}

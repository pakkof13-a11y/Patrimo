/**
 * Sections du panneau latéral d'un contrat d'assurance-vie.
 *
 * Registre déclaratif et pur, sur le modèle de celui de l'espace de travail
 * d'un actif : il dit quelles sections existent et dans quel ordre, le
 * composant se contente de le parcourir.
 *
 * `backing` dit d'où vient la donnée — c'est ce qui autorise une section à
 * exister sans rien montrer de faux :
 *
 * - `"data"`    — le back-end sert déjà la section.
 * - `"pending"` — l'écran est en place, le modèle de données n'existe pas
 *                 encore. La section annonce ce qu'elle attend au lieu
 *                 d'inventer des bénéficiaires ou des documents.
 */

export type ContractSectionId =
  | "overview"
  | "supports"
  | "history"
  | "fees"
  | "tax"
  | "beneficiaries"
  | "arbitrages"
  | "documents";

export type ContractSection = {
  id: ContractSectionId;
  label: string;
  /** Ce à quoi la section répond, pas ce qu'elle est. */
  hint: string;
  backing: "data" | "pending";
};

export const CONTRACT_SECTIONS: ContractSection[] = [
  {
    id: "overview",
    label: "Vue d'ensemble",
    hint: "Ce que vaut le contrat, comment il est réparti, où il en est",
    backing: "data",
  },
  {
    id: "supports",
    label: "Supports",
    hint: "Le détail ligne à ligne de l'épargne investie",
    backing: "data",
  },
  {
    id: "history",
    label: "Historique",
    hint: "Versements, arbitrages et rachats passés par le journal",
    backing: "data",
  },
  {
    id: "fees",
    label: "Frais",
    hint: "Ce que le contrat prélève, par support et au total",
    backing: "data",
  },
  {
    id: "tax",
    label: "Fiscalité",
    hint: "Antériorité, abattement et taux applicable en cas de rachat",
    backing: "data",
  },
  {
    id: "beneficiaries",
    label: "Bénéficiaires",
    hint: "La clause bénéficiaire et sa répartition",
    backing: "pending",
  },
  {
    id: "arbitrages",
    label: "Arbitrages",
    hint: "Réallocation entre supports, programmée ou ponctuelle",
    backing: "pending",
  },
  {
    id: "documents",
    label: "Documents",
    hint: "Conditions générales, relevés annuels, avenants",
    backing: "pending",
  },
];

/**
 * Classification / qualité des données NFT — fonctions pures (D9 de
 * `docs/nft-backend-v1.md`).
 *
 * La détection spam est une heuristique déclarative, jamais définitive :
 * `SUSPECTED` reste visible et valorisable, seul `CONFIRMED_SPAM` retire la
 * valorisation positive par défaut (`blocksPositiveValuationByDefault`,
 * `nft-taxonomy.ts`). Elle ne s'exécute qu'**une fois**, à la découverte du
 * NFT (`NftAsset` créé pour la première fois) — jamais rejouée sur un NFT
 * déjà connu, pour ne jamais écraser silencieusement une requalification
 * manuelle (cas 55 du cahier des charges : un spam réellement détenu et
 * volontairement conservé, géré par `reclassifyNftSpam` côté service, pas
 * par un recalcul de cette fonction).
 */

import Decimal from "decimal.js";
import type { NftMetadataQuality, NftSpamStatus } from "./nft-taxonomy";

/**
 * Motifs communs de phishing NFT — incitation à « réclamer », lien externe
 * dans le nom/la description. Table explicite plutôt que ML : un faux
 * positif se corrige d'une ligne, un modèle se trompe en silence.
 */
const PHISHING_PATTERNS =
  /https?:\/\/|\bclaim\s+(now|your|reward)|\bairdrop\s+claim\b|redeem\s+now|\bvisit\b.*\.(com|io|xyz|app)\b/i;

export type SpamClassificationInput = {
  collectionVerifiedStatus: string;
  hasReliableFloor: boolean;
  acquisitionSource: string;
  acquisitionCostEur: Decimal | null;
  name: string | null;
  description: string | null;
};

export type SpamClassification = {
  /** CLEAN | SUSPECTED | CONFIRMED_SPAM — jamais IGNORED_BY_USER : cet état
   * ne résulte que d'une reclassification manuelle explicite. */
  spamStatus: NftSpamStatus;
  reason: string | null;
};

export function classifyNftSpam(input: SpamClassificationInput): SpamClassification {
  const text = `${input.name ?? ""} ${input.description ?? ""}`;
  if (PHISHING_PATTERNS.test(text)) {
    return {
      spamStatus: "CONFIRMED_SPAM",
      reason: "Nom ou description contient un motif caractéristique de phishing (lien, incitation à réclamer).",
    };
  }

  const isFreeAirdropWithoutValue =
    input.acquisitionSource === "AIRDROP" &&
    !input.hasReliableFloor &&
    (input.acquisitionCostEur == null || input.acquisitionCostEur.lte(0));

  if (input.collectionVerifiedStatus === "UNVERIFIED" && isFreeAirdropWithoutValue) {
    return {
      spamStatus: "SUSPECTED",
      reason: "Airdrop non sollicité, collection non vérifiée, aucun floor connu.",
    };
  }

  return { spamStatus: "CLEAN", reason: null };
}

/**
 * `NftAsset` ne porte que deux booléens (`isSpam`/`isScamSuspected`), pas un
 * champ à 4 états — `NftCollection.spamStatus` est le seul endroit qui en a
 * besoin (une collection reste `IGNORED_BY_USER` au sens propre). Cette
 * fonction traduit le résultat de `classifyNftSpam` vers ces deux colonnes.
 */
export function spamStatusToAssetFlags(status: NftSpamStatus): {
  isSpam: boolean;
  isScamSuspected: boolean;
} {
  switch (status) {
    case "CONFIRMED_SPAM":
      return { isSpam: true, isScamSuspected: true };
    case "SUSPECTED":
      return { isSpam: false, isScamSuspected: true };
    default:
      return { isSpam: false, isScamSuspected: false };
  }
}

/**
 * Qualité de la metadata d'un `NftAsset` précis — distincte de celle d'une
 * `NftCollection` (qui qualifie la fiche de collection, pas un NFT donné).
 */
export function assessNftMetadataQuality(input: {
  hasName: boolean;
  hasImage: boolean;
  hasRawMetadata: boolean;
  /** La réponse provider a été reçue mais n'a pas pu être interprétée (JSON invalide). */
  parseFailed: boolean;
}): NftMetadataQuality {
  if (input.parseFailed) return "BROKEN";
  if (input.hasName && input.hasImage) return "COMPLETE";
  if (input.hasName || input.hasImage || input.hasRawMetadata) return "PARTIAL";
  return "UNKNOWN";
}

/**
 * Vocabulaire métier des comptes titres.
 *
 * Séparé de `app/lib/constants.ts` pour la même raison que la crypto et
 * l'immobilier : ces listes ne concernent qu'un module. Chaîne + union TS
 * plutôt qu'une enum Prisma, conformément au reste du dépôt — le vocabulaire
 * métier évolue sans migration.
 */

export const SECURITIES_ENVELOPE_TYPES = {
  PEA: "PEA",
  PEA_PME: "PEA-PME",
  CTO: "Compte-titres",
} as const;

export type SecuritiesEnvelopeType = keyof typeof SECURITIES_ENVELOPE_TYPES;

export function securitiesEnvelopeLabel(value: string): string {
  return (
    SECURITIES_ENVELOPE_TYPES[value as SecuritiesEnvelopeType] ?? value
  );
}

export function isSecuritiesEnvelopeType(
  value: string
): value is SecuritiesEnvelopeType {
  return value in SECURITIES_ENVELOPE_TYPES;
}

/**
 * Enveloppes dont la loi limite la détention à un compte par personne.
 *
 * Ce n'est pas une règle applicative qu'on pourrait assouplir : un
 * contribuable ne peut détenir qu'un PEA et qu'un PEA-PME. Le compte-titres
 * ordinaire, lui, n'est pas plafonné en nombre — en détenir chez plusieurs
 * courtiers est courant. C'est cette asymétrie qui interdit un
 * `@@unique([userId, envelopeType])` complet et impose l'index partiel posé
 * dans la migration ; cette constante en est le pendant applicatif, chargé de
 * produire un message lisible avant que la base ne parle en violation d'index.
 */
export const SINGLE_ACCOUNT_ENVELOPES: readonly SecuritiesEnvelopeType[] = [
  "PEA",
  "PEA_PME",
];

export function isSingleAccountEnvelope(value: string): boolean {
  return (SINGLE_ACCOUNT_ENVELOPES as readonly string[]).includes(value);
}

/**
 * Enveloppe fiscale (`Asset.accountType`) que porte un compte de ce type.
 *
 * PEA et PEA-PME partagent la valeur `PEA` : `accountType` décrit la **famille
 * fiscale** d'une ligne, et les deux plans obéissent au même régime (règle des
 * 5 ans, exonération d'IR, prélèvements sociaux dus). Ce qui les distingue —
 * un plafond de versement propre, et un plafond commun aux deux — se lit sur
 * le compte via `envelopeType`, pas sur l'actif.
 *
 * Ajouter `PEA_PME` à `ACCOUNT_TYPES` aurait été l'autre option : elle aurait
 * imposé de traiter cette valeur dans tout ce qui itère sur les enveloppes
 * (rapport fiscal, sélecteurs, filtres de positions, libellés) pour une
 * distinction dont aucun de ces endroits n'a l'usage.
 */
export function accountTypeForEnvelope(
  envelopeType: SecuritiesEnvelopeType
): "PEA" | "CTO" {
  return envelopeType === "CTO" ? "CTO" : "PEA";
}

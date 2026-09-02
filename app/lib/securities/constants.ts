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

/**
 * Le rattachement survit-il à un changement d'enveloppe fiscale ?
 *
 * `setAssetAccount` refuse déjà de **créer** un rattachement incohérent :
 * déplacer une ligne d'un CTO vers un PEA est un transfert de titres, pas une
 * correction de saisie. Mais changer l'`accountType` d'une ligne **déjà
 * rattachée** contournait cette garde : la ligne devenait PEA tout en pointant
 * vers un compte CTO.
 *
 * Le résultat n'était pas une ligne orpheline — c'eût été visible — mais une
 * ligne **mal attribuée** : elle s'affichait dans la carte du CTO, entrait
 * dans sa valeur liquidative, dans sa simulation de retrait et dans son
 * rapport fiscal, tout en se déclarant PEA. Et elle échappait au bandeau des
 * non rattachées, puisqu'elle avait bien un identifiant de compte.
 *
 * La règle tient en une comparaison de **familles fiscales**, pas de types de
 * compte : un PEA-PME et un PEA portent tous deux des lignes `PEA`, et passer
 * de l'un à l'autre ne casse rien. C'est `accountTypeForEnvelope` qui tranche,
 * pour qu'il n'existe qu'une seule définition de cette équivalence.
 *
 * Rend `true` quand la ligne doit être **détachée**. Le rattachement n'est
 * jamais reporté sur un autre compte : deviner lequel serait inventer une
 * information que l'utilisateur seul détient.
 */
export function envelopeChangeBreaksAttachment(
  currentEnvelopeType: string | null | undefined,
  nextAccountType: string
): boolean {
  // Pas de rattachement : rien à défaire.
  if (!currentEnvelopeType) return false;
  /*
    Type de compte inconnu : on ne peut pas affirmer que le rattachement reste
    valide, et le conserver serait le pari risqué. On détache.
  */
  if (!isSecuritiesEnvelopeType(currentEnvelopeType)) return true;
  return accountTypeForEnvelope(currentEnvelopeType) !== nextAccountType;
}

/**
 * Comptes auxquels une ligne peut être rattachée, compte tenu de son enveloppe.
 *
 * Le service refuse déjà un rattachement incohérent — déplacer une ligne d'un
 * CTO vers un PEA est un transfert de titres, pas une correction de saisie.
 * Filtrer en amont évite de proposer un choix voué à l'échec : mieux vaut ne
 * pas offrir l'option que de la refuser après coup.
 *
 * Une ligne PEA peut aller indifféremment sur un PEA ou un PEA-PME : les deux
 * partagent la même famille fiscale, seul leur plafond diffère.
 */
export function eligibleAccounts<T extends { envelopeType: string }>(
  positionAccountType: string,
  accounts: readonly T[]
): T[] {
  return accounts.filter(
    (a) =>
      isSecuritiesEnvelopeType(a.envelopeType) &&
      accountTypeForEnvelope(a.envelopeType) === positionAccountType
  );
}

/**
 * Enveloppes dont le module de lecture part d'une table de détail.
 *
 * La plupart des modules énumèrent les positions du journal et enrichissent
 * chacune de sa fiche métier quand elle existe : une ligne sans fiche reste
 * visible, éventuellement signalée. L'Immobilier fait l'inverse — ses deux
 * onglets partent de `RealEstateDetail` et de `IndirectRealEstateDetail`, puis
 * joignent le journal. Une position sans fiche n'y figure donc dans aucune
 * liste, tout en pesant dans le patrimoine et dans l'assiette IFI.
 *
 * C'est exactement ce qui est arrivé à deux SCPI : 25 240 € comptés au
 * patrimoine, absents du module et de l'IFI, sans qu'aucun écran ne le dise.
 * Le seed a été corrigé, mais deux portes d'écriture permettaient de recréer
 * l'état à volonté. Ce module porte la règle qu'elles consultent.
 *
 * ## Pourquoi l'assurance-vie n'y figure pas
 *
 * Elle a la même forme et pas le même défaut. `listSupports()` part des actifs
 * `accountType = "AV"` et rattache le support en jointure facultative : un
 * support orphelin apparaît quand même, dans une section « Supports sans
 * contrat rattaché » qui propose de le relier. L'état incomplet y est atteignable
 * et visible — donc légitime. Lui interdire l'écriture bloquerait un flux qui
 * fonctionne.
 *
 * Les autres enveloppes — CTO, PEA, CRYPTO, CFD — n'ont pas de table de détail
 * obligatoire. Rien à exiger.
 */

/** Fiches métier qu'une enveloppe peut exiger. */
export type AssetDetailPresence = {
  /** Bien détenu en direct — `RealEstateDetail`. */
  hasRealEstate: boolean;
  /** Véhicule indirect : SCPI, SCI, OPCI, SIIC — `IndirectRealEstateDetail`. */
  hasIndirectRealEstate: boolean;
};

/** Enveloppes dont un actif ne peut pas se passer de fiche métier. */
export const ENVELOPES_REQUIRING_DETAIL = ["IMMOBILIER"] as const;

export function envelopeRequiresDetail(accountType: string | null | undefined): boolean {
  return ENVELOPES_REQUIRING_DETAIL.includes(
    (accountType ?? "") as (typeof ENVELOPES_REQUIRING_DETAIL)[number]
  );
}

/** Une des deux formes d'immobilier suffit — jamais les deux. */
export function hasRealEstateDetail(presence: AssetDetailPresence): boolean {
  return presence.hasRealEstate || presence.hasIndirectRealEstate;
}

/**
 * Pourquoi cet actif ne peut pas entrer dans cette enveloppe, ou `null`.
 *
 * Le message nomme les deux chemins de création, parce que refuser sans dire
 * où aller ne fait que déplacer le problème. Il ne prescrit pas la forme :
 * une SCPI n'a pas à recevoir une fiche de bien direct, et lui en fabriquer
 * une inventerait une adresse.
 */
export function detailRequirementError(
  accountType: string | null | undefined,
  presence: AssetDetailPresence
): string | null {
  if (!envelopeRequiresDetail(accountType)) return null;
  if (hasRealEstateDetail(presence)) return null;
  return (
    "Un actif ne peut pas être classé en IMMOBILIER sans fiche immobilière. " +
    "Créez un bien détenu en direct depuis Immobilier › Biens, ou une SCPI, " +
    "SCI ou foncière depuis Immobilier › SCPI & sociétés."
  );
}

/**
 * Pourquoi cet actif ne peut pas quitter cette enveloppe, ou `null`.
 *
 * Le sens inverse produit l'autre moitié du défaut : la fiche survit au
 * changement — elle ne disparaît qu'avec l'actif — et son onglet continue de
 * la lister, désormais rattachée à une position que le module ne valorise
 * plus. `buildPropertyView` ouvre sur la valeur du holding immobilier : sans
 * lui, le bien s'affiche à 0 €, en silence.
 */
export function detailOrphanError(
  previousAccountType: string | null | undefined,
  nextAccountType: string | null | undefined,
  presence: AssetDetailPresence
): string | null {
  if (!envelopeRequiresDetail(previousAccountType)) return null;
  if (envelopeRequiresDetail(nextAccountType)) return null;
  if (!hasRealEstateDetail(presence)) return null;
  return (
    "Cet actif porte une fiche immobilière : le sortir de l'enveloppe " +
    "IMMOBILIER l'afficherait à 0 € dans son onglet. Retirez-le depuis le " +
    "module Immobilier si vous ne le détenez plus."
  );
}

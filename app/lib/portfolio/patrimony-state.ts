/**
 * Le compte porte-t-il la moindre donnée patrimoniale ?
 *
 * C'est la seule question qui décide entre le cockpit d'accueil et le tableau
 * de bord. Elle se lit sur les **données réelles**, jamais sur une préférence
 * d'interface : `onboardingShowEveryStart` et consorts décrivent un souhait
 * d'affichage, pas l'état du compte, et s'en servir faisait réapparaître
 * l'accueil à un utilisateur qui possédait déjà tout son patrimoine.
 *
 * La liste des familles interrogées ici est le **miroir exact** de ce que
 * `resetUserData` supprime — les deux vivent volontairement dans le même
 * dossier. Une famille ajoutée à la remise à zéro sans l'être ici produirait
 * un compte vidé qui refuserait d'afficher son cockpit, et l'inverse un compte
 * qui l'afficherait en possédant encore des données.
 */

import { prisma } from "@/app/lib/prisma";

/**
 * Ce qu'on compte. Chaque entrée vaut « au moins une ligne » — les nombres
 * exacts n'intéressent personne ici, seule leur nullité compte.
 */
export type PatrimonyPresence = {
  transactions: boolean;
  assets: boolean;
  platforms: boolean;
  liabilities: boolean;
  bankAccounts: boolean;
  savingsAccounts: boolean;
  lifeInsurances: boolean;
  envelopeCash: boolean;
  employeeSavings: boolean;
  alternatives: boolean;
  realEstate: boolean;
  /**
   * Positions à levier.
   *
   * Rattachées à `User` et non à `Asset` — un contrat n'est pas un actif
   * détenu — elles échappaient au recensement : un compte dont c'était la
   * seule activité était présenté comme vierge, et le cockpit d'accueil
   * s'affichait par-dessus des positions bien réelles.
   */
  trading: boolean;
};

/**
 * Fonction **pure** : un compte est vierge quand aucune famille n'a de ligne.
 *
 * Séparée de l'accès aux données pour être testable, et pour que la règle —
 * « une seule donnée suffit à rendre le compte actif » — soit lisible d'un
 * coup d'œil plutôt que noyée dans onze requêtes.
 */
export function patrimonyIsEmpty(presence: PatrimonyPresence): boolean {
  return !Object.values(presence).some(Boolean);
}

/** Familles renseignées, pour le diagnostic et les tests. */
export function presentFamilies(presence: PatrimonyPresence): string[] {
  return Object.entries(presence)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();
}

const some = async (fn: () => Promise<number>): Promise<boolean> => {
  try {
    return (await fn()) > 0;
  } catch {
    /*
      Un modèle absent d'une base ancienne ne rend pas le compte actif.

      `resetUserData` applique déjà cette tolérance sur les mêmes tables. La
      renverser ici — compter l'erreur comme « il y a des données » —
      empêcherait le cockpit de s'afficher sur un compte réellement vierge,
      et l'utilisateur n'aurait aucun moyen de comprendre pourquoi.
    */
    return false;
  }
};

/**
 * Interroge toutes les familles en parallèle.
 *
 * Onze requêtes `count` indexées sur `userId`, lancées ensemble : c'est le prix
 * d'une réponse juste, et elle n'est demandée qu'une fois au chargement de
 * l'application. Chaque `count` s'arrête au premier enregistrement trouvé
 * (`take: 1` via `findFirst`) plutôt que de dénombrer une table entière.
 */
export async function loadPatrimonyPresence(
  userId: string
): Promise<PatrimonyPresence> {
  const exists = (
    fn: (args: { where: { userId: string }; select: { id: true } }) => Promise<unknown>
  ) =>
    some(async () =>
      (await fn({ where: { userId }, select: { id: true } })) ? 1 : 0
    );

  const [
    transactions,
    assets,
    platforms,
    liabilities,
    bankAccounts,
    savingsAccounts,
    lifeInsurances,
    envelopeCash,
    employeeSavings,
    metals,
    privateEquity,
    crowdlending,
    tangibles,
    realEstate,
    trading,
  ] = await Promise.all([
    exists((a) => prisma.transaction.findFirst(a)),
    exists((a) => prisma.asset.findFirst(a)),
    exists((a) => prisma.platform.findFirst(a)),
    exists((a) => prisma.liability.findFirst(a)),
    exists((a) => prisma.bankAccount.findFirst(a)),
    exists((a) => prisma.savingsAccount.findFirst(a)),
    exists((a) => prisma.lifeInsurance.findFirst(a)),
    exists((a) => prisma.envelopeCash.findFirst(a)),
    exists((a) => prisma.employeeSavingsLine.findFirst(a)),
    exists((a) => prisma.preciousMetalPosition.findFirst(a)),
    exists((a) => prisma.privateEquityPosition.findFirst(a)),
    exists((a) => prisma.crowdlendingPosition.findFirst(a)),
    exists((a) => prisma.tangibleAsset.findFirst(a)),
    /*
      L'immobilier détenu en direct est un `Asset` doublé d'un
      `RealEstateDetail`. Le compter à part ne change rien tant que l'actif
      existe — mais une fiche orpheline, si elle survivait à une suppression
      d'actif, signalerait tout de même une donnée saisie.
    */
    some(async () =>
      (await prisma.realEstateDetail.findFirst({
        where: { asset: { userId } },
        select: { id: true },
      }))
        ? 1
        : 0
    ),
    exists((a) => prisma.tradingPosition.findFirst(a)),
  ]);

  return {
    transactions,
    assets,
    platforms,
    liabilities,
    bankAccounts,
    savingsAccounts,
    lifeInsurances,
    envelopeCash,
    employeeSavings,
    alternatives: metals || privateEquity || crowdlending || tangibles,
    realEstate,
    trading,
  };
}

/** Réponse de `/api/patrimony-state`. */
export type PatrimonyStateResponse = {
  isEmpty: boolean;
  /** Familles renseignées — sert au diagnostic, jamais à l'affichage. */
  families: string[];
};

export async function getPatrimonyState(
  userId: string
): Promise<PatrimonyStateResponse> {
  const presence = await loadPatrimonyPresence(userId);
  return {
    isEmpty: patrimonyIsEmpty(presence),
    families: presentFamilies(presence),
  };
}

export {
  allocationAssetClass,
  checkPatrimonyIdentities,
  classifyHolding,
  classifyHoldings,
  computePatrimonyMetrics,
  formatPatrimonyPocketTable,
  serializePatrimonyMetrics,
  CENTIME_EUR,
  LISTED_ASSET_CLASSES,
  LISTED_EXCLUDED_ACCOUNT_TYPES,
  PATRIMONY_ASSET_POCKETS,
  PATRIMONY_POCKETS,
} from "./patrimony-metrics";
export type {
  ClassifiableHolding,
  HoldingPocket,
  PatrimonyMetrics,
  PatrimonyMetricsJson,
  PatrimonyPocket,
  PatrimonyPockets,
} from "./patrimony-metrics";

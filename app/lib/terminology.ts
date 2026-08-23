/**
 * Vocabulaire patrimonial d'Aurea — plateforme, enveloppe, compte.
 *
 * Ces trois mots se recouvraient dans l'interface au point qu'un même écran
 * pouvait employer « compte » et « enveloppe » pour la même chose. Ce module
 * fixe la définition de chacun et porte les libellés qui en découlent.
 *
 * Ce n'est **pas** une couche de traduction : Aurea n'a pas d'i18n, et en
 * introduire une par la bande créerait un second système de libellés à côté de
 * `constants.ts`. C'est un glossaire, doublé des rares helpers qui évitaient
 * d'être redéfinis dans chaque module.
 *
 * ── Plateforme ───────────────────────────────────────────────────────────
 *
 * L'établissement d'où vient la donnée : courtier, banque, exchange, wallet.
 * Modèle `Platform`. Répond à « où se trouve la donnée, et d'où Aurea la
 * récupère-t-il ? ».
 *
 * Une plateforme ne porte **aucune** entité « compte » générique. Ce qu'elle
 * contient se ventile par enveloppe, jamais par compte — c'est la contrainte
 * qu'a établie la refonte du module Plateformes, et l'interface ne doit pas la
 * contourner par le choix des mots.
 *
 * ── Enveloppe ────────────────────────────────────────────────────────────
 *
 * Le cadre fiscal et de détention d'une position : CTO, PEA, assurance-vie,
 * crypto, immobilier, CFD. Répond à « dans quel cadre patrimonial l'actif
 * est-il détenu ? ».
 *
 * Portée par `Asset.accountType`, dont le nom est **historique et trompeur** :
 * le champ contient une enveloppe, pas un type de compte. Le renommer
 * toucherait le schéma, le ledger, les moteurs fiscaux, l'import et une
 * trentaine de fichiers, pour un gain purement cosmétique — voir la note en
 * bas de ce fichier. Le vocabulaire **visible**, lui, dit « enveloppe ».
 *
 * ── Compte ───────────────────────────────────────────────────────────────
 *
 * Un compte réel et nommable chez un établissement, avec sa propre existence
 * juridique ou contractuelle. Aurea en connaît quatre familles, toutes des
 * modèles distincts, sans parent commun :
 *
 *   `BankAccount`       compte courant, joint, professionnel ;
 *   `SavingsAccount`    livret ;
 *   `SecuritiesAccount` compte-titres, PEA, PEA-PME ;
 *   `TradingAccount`    compte de courtage à levier (CFD, futures).
 *
 * Il n'existe pas d'entité `Account` générique, et il ne faut pas en créer une
 * — ni dans le modèle, ni implicitement par les libellés. « Compte » ne
 * s'emploie que là où l'une de ces quatre familles est réellement en jeu.
 *
 * ── La règle en une ligne ────────────────────────────────────────────────
 *
 *   D'où vient la donnée ?      → plateforme
 *   Dans quel cadre fiscal ?    → enveloppe
 *   Quel compte précisément ?   → compte, si et seulement s'il en existe un
 *
 * Ne jamais forcer les trois niveaux dans un écran qui n'en porte que deux.
 */

import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";

/**
 * Libellés des enveloppes fiscales.
 *
 * Alias nommé de `ACCOUNT_TYPES`, dont le nom historique désigne un « type de
 * compte » alors qu'il contient des enveloppes. Les deux pointent la même
 * table : il n'y a pas deux sources, seulement un nom qui dit enfin ce que la
 * valeur est.
 */
export const ENVELOPE_LABELS = ACCOUNT_TYPES;

export type EnvelopeType = AccountType;

/** Libellé d'une enveloppe, ou la clé brute si elle n'est pas répertoriée. */
export function envelopeLabel(envelope: string): string {
  return ENVELOPE_LABELS[envelope as EnvelopeType] ?? envelope;
}

/**
 * Note sur les noms internes délibérément conservés.
 *
 * `Asset.accountType`, le paramètre d'API `accountType`, `AccountType` et
 * `ACCOUNT_TYPES` gardent leur nom. Ils traversent le schéma Prisma, le moteur
 * comptable, les moteurs fiscaux, l'import CSV et les URL de filtre : les
 * renommer imposerait une migration et casserait des liens partagés, sans rien
 * changer pour l'utilisateur.
 *
 * La règle retenue est celle du chantier : **le vocabulaire visible est
 * cohérent, les noms internes historiques peuvent rester différents.**
 */
export const INTERNAL_NAMES_KEPT = [
  "Asset.accountType",
  "ACCOUNT_TYPES / AccountType",
  "TAB_TO_ACCOUNT_TYPE",
  "?accountType= (filtre Transactions)",
] as const;

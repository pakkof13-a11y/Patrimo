"use client";

import { useEffect, useState } from "react";
import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";

/**
 * Mode confidentialité — masque les montants affichés.
 *
 * Le besoin n'est pas la sécurité mais le regard d'à côté : un train, un
 * open space, un partage d'écran. On ne cache donc ni les libellés, ni les
 * pourcentages, ni les courbes — seulement les montants, ceux qu'on ne veut
 * pas voir lus par-dessus l'épaule. La bascule est instantanée et sans
 * confirmation : une protection qui demande trois clics n'est pas utilisée.
 *
 * Le réglage vit dans le navigateur, pas en base : il décrit l'endroit où
 * l'on se trouve, pas le compte. Un poste public reste masqué, le poste
 * personnel reste lisible.
 */
export const AMOUNTS_HIDDEN_KEY = "amountsHidden";

/** Ce qui remplace un montant masqué. Longueur fixe : ne trahit pas l'ordre
 *  de grandeur, contrairement à une masse d'astérisques proportionnelle. */
export const MASKED_AMOUNT = "****";

export function loadAmountsHidden(): boolean {
  return loadUiPref(AMOUNTS_HIDDEN_KEY, false);
}

export function saveAmountsHidden(hidden: boolean): void {
  saveUiPref(AMOUNTS_HIDDEN_KEY, hidden);
  try {
    window.dispatchEvent(new CustomEvent("patrimo:amounts-hidden"));
  } catch {
    /* environnement sans window (tests, SSR) */
  }
}

/**
 * Applique le masque à un montant déjà formaté.
 *
 * Prend la chaîne finale plutôt que le nombre : le masque ne doit jamais
 * dépendre de la valeur, sans quoi la longueur de la substitution laisserait
 * deviner le montant.
 */
export function maskAmount(formatted: string, hidden: boolean): string {
  return hidden ? MASKED_AMOUNT : formatted;
}

/**
 * État partagé du mode confidentialité.
 *
 * L'événement `patrimo:amounts-hidden` synchronise les composants d'un même
 * onglet, `storage` ceux des autres onglets : basculer depuis le tableau de
 * bord ne doit pas laisser un montant à découvert dans une fenêtre voisine.
 */
export function useAmountsHidden(): [boolean, (next: boolean) => void] {
  const [hidden, setHidden] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Lecture client-only : le serveur ne connaît pas le localStorage, et rendre
  // « masqué » côté serveur ferait clignoter tous les montants au montage.
  if (!seeded) {
    setSeeded(true);
    setHidden(loadAmountsHidden());
  }

  useEffect(() => {
    function sync() {
      setHidden(loadAmountsHidden());
    }
    window.addEventListener("patrimo:amounts-hidden", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("patrimo:amounts-hidden", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [
    hidden,
    (next: boolean) => {
      setHidden(next);
      saveAmountsHidden(next);
    },
  ];
}

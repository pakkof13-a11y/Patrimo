import { describe, expect, it } from "vitest";
import {
  countsInPersonalNetWorth,
  personalAmountOf,
  personalShareOf,
} from "@/app/lib/cash/ownership";

/**
 * Ce qu'un compte apporte au patrimoine **personnel**.
 *
 * Les deux champs existaient, le schéma les documentait, l'écran les
 * promettait — et aucun total ne les lisait. Ces contrôles fixent la règle à
 * l'endroit unique où elle vit désormais, pour que `getExplicitCashTotalEur` et
 * `summarizeCash` ne puissent plus répondre deux choses différentes.
 */
describe("personalShareOf", () => {
  it("un compte individuel compte pour lui-même", () => {
    expect(personalShareOf({}).toNumber()).toBe(1);
    expect(personalShareOf({ isPro: false, ownershipPct: null }).toNumber()).toBe(1);
  });

  it("un compte joint compte pour la part détenue", () => {
    expect(personalShareOf({ ownershipPct: "50" }).toNumber()).toBe(0.5);
    expect(personalAmountOf("10000", { ownershipPct: "50" }).toNumber()).toBe(5000);
  });

  /*
    La consigne du chantier, mot pour mot : un compte pro à 100 % ne rentre pas
    dans le Net. Les deux champs ne se composent pas — `isPro` dit « ce n'est
    pas mon patrimoine », la quote-part dit « voici ce qui m'en revient ». La
    seconde ne rattrape pas la première.
  */
  it("un compte professionnel ne compte pas, même détenu à 100 %", () => {
    expect(personalShareOf({ isPro: true, ownershipPct: "100" }).toNumber()).toBe(0);
    expect(personalAmountOf("40000", { isPro: true }).toNumber()).toBe(0);
  });

  it("countsInPersonalNetWorth ne parle que du caractère professionnel", () => {
    expect(countsInPersonalNetWorth({ isPro: true })).toBe(false);
    // Une quote-part réduit un montant, elle n'exclut pas la ligne.
    expect(countsInPersonalNetWorth({ ownershipPct: "50" })).toBe(true);
  });

  /*
    Une quote-part illisible ou hors bornes retombe sur 1 plutôt que d'inventer
    un chiffre : la borne est posée à la saisie, et un total trop bas se
    remarque moins — donc se corrige moins vite — qu'un total trop haut.
  */
  it("une quote-part inutilisable ne fabrique pas de fraction", () => {
    expect(personalShareOf({ ownershipPct: "abc" }).toNumber()).toBe(1);
    expect(personalShareOf({ ownershipPct: "150" }).toNumber()).toBe(1);
    expect(personalShareOf({ ownershipPct: "-10" }).toNumber()).toBe(1);
    expect(personalShareOf({ ownershipPct: "" }).toNumber()).toBe(1);
  });

  it("le signe du solde n'entre pas dans la règle", () => {
    // Un découvert est une donnée saisie au même titre qu'un solde créditeur.
    expect(personalAmountOf("-1200", { ownershipPct: "50" }).toNumber()).toBe(-600);
  });
});

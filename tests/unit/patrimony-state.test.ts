import { describe, expect, it } from "vitest";
import {
  patrimonyIsEmpty,
  presentFamilies,
  type PatrimonyPresence,
} from "@/app/lib/portfolio/patrimony-state";

const EMPTY: PatrimonyPresence = {
  transactions: false,
  assets: false,
  platforms: false,
  liabilities: false,
  bankAccounts: false,
  savingsAccounts: false,
  lifeInsurances: false,
  envelopeCash: false,
  employeeSavings: false,
  alternatives: false,
  realEstate: false,
  trading: false,
};

describe("état patrimonial du compte", () => {
  it("une position à levier suffit à rendre le compte actif", () => {
    /*
      Une position à levier est rattachée à l'utilisateur, pas à un actif : un
      compte dont c'est la seule activité échappait au recensement et voyait
      le cockpit d'accueil s'afficher par-dessus des positions bien réelles.
    */
    expect(patrimonyIsEmpty({ ...EMPTY, trading: true })).toBe(false);
    expect(presentFamilies({ ...EMPTY, trading: true })).toEqual(["trading"]);
  });

  it("un compte sans aucune donnée est vierge", () => {
    expect(patrimonyIsEmpty(EMPTY)).toBe(true);
    expect(presentFamilies(EMPTY)).toEqual([]);
  });

  it("une seule donnée suffit à rendre le compte actif", () => {
    /*
      C'est la règle centrale. L'écran d'accueil se décidait auparavant sur les
      seules positions : un compte ne portant qu'une dette, qu'un livret ou
      qu'un contrat d'assurance-vie était traité comme vierge, et se voyait
      proposer de « commencer » alors qu'il avait déjà commencé.
    */
    const families = Object.keys(EMPTY) as Array<keyof PatrimonyPresence>;
    for (const family of families) {
      const withOne: PatrimonyPresence = { ...EMPTY, [family]: true };
      expect(
        patrimonyIsEmpty(withOne),
        `${family} seule devrait rendre le compte actif`
      ).toBe(false);
    }
  });

  it("une transaction sans position calculée n'est pas un compte vierge", () => {
    // Le cas exact que `holdings.length === 0` traitait à tort.
    expect(patrimonyIsEmpty({ ...EMPTY, transactions: true })).toBe(false);
  });

  it("un compte ne portant qu'un passif n'est pas vierge", () => {
    expect(patrimonyIsEmpty({ ...EMPTY, liabilities: true })).toBe(false);
  });

  it("un compte ne portant qu'un bien immobilier n'est pas vierge", () => {
    expect(patrimonyIsEmpty({ ...EMPTY, realEstate: true })).toBe(false);
  });

  it("un compte ne portant qu'une plateforme n'est pas vierge", () => {
    // Une plateforme configurée est une donnée saisie, même sans opération.
    expect(patrimonyIsEmpty({ ...EMPTY, platforms: true })).toBe(false);
  });

  it("après suppression de toutes les données, le compte redevient vierge", () => {
    const active: PatrimonyPresence = {
      ...EMPTY,
      transactions: true,
      assets: true,
      platforms: true,
      bankAccounts: true,
    };
    expect(patrimonyIsEmpty(active)).toBe(false);

    // Réinitialisation complète : toutes les familles retombent à faux.
    expect(patrimonyIsEmpty(EMPTY)).toBe(true);
  });

  it("énumère les familles renseignées pour le diagnostic", () => {
    expect(
      presentFamilies({ ...EMPTY, bankAccounts: true, liabilities: true })
    ).toEqual(["bankAccounts", "liabilities"]);
  });
});

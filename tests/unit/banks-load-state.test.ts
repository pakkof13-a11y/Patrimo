import { describe, expect, it } from "vitest";
import { resolveLoadState } from "@/components/banks/load-state";

/*
  Onglet Banques, vue d'ensemble : « 0 établissement », « 0 compte » et
  « Total banques 0,00 € » se lisaient au premier rendu, avant toute réponse,
  puis la vraie valeur. Les dérivés de `products` ne sont fiables que quand
  les trois listes ont répondu — et un échec ne doit pas se lire comme un
  compte vide.
*/
describe("resolveLoadState", () => {
  const pending = { isPending: true, data: undefined };
  const loaded = { isPending: false, data: { accounts: [] } };
  const failed = { isPending: false, data: undefined };

  it("premier rendu : rien n'a répondu → loading, jamais un zéro inventé", () => {
    expect(resolveLoadState([pending, pending, pending])).toBe("loading");
  });

  it("réponse partielle : une liste encore en attente → toujours loading", () => {
    expect(resolveLoadState([loaded, pending, loaded])).toBe("loading");
  });

  it("toutes ont répondu, même vides → known : un vrai vide garde son état vide", () => {
    expect(resolveLoadState([loaded, loaded, loaded])).toBe("known");
  });

  it("plus rien en attente et une réponse manque → unavailable, pas « 0 compte »", () => {
    expect(resolveLoadState([loaded, failed, loaded])).toBe("unavailable");
    expect(resolveLoadState([failed, failed, failed])).toBe("unavailable");
  });

  it("une liste en échec, une autre encore en attente → loading tant que tout n'a pas tranché", () => {
    expect(resolveLoadState([failed, pending])).toBe("loading");
  });

  it("une réponse en cache reste connue pendant un rafraîchissement (isPending est faux)", () => {
    expect(
      resolveLoadState([{ isPending: false, data: { accounts: [] } }])
    ).toBe("known");
  });
});

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import {
  loadAmountsHidden,
  maskAmount,
  MASKED_AMOUNT,
  saveAmountsHidden,
} from "@/app/lib/ui/privacy-prefs";

/**
 * Mode confidentialité — la substitution ne doit rien laisser filtrer.
 */
describe("masque des montants", () => {
  // Environnement `node` : on branche un stockage minimal, comme les autres
  // tests de préférences (cf. `evolution-prefs.test.ts`).
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  afterEach(() => {
    // @ts-expect-error nettoyage
    delete globalThis.localStorage;
    // @ts-expect-error nettoyage
    delete globalThis.window;
  });

  it("rend le montant intact quand le masque est levé", () => {
    expect(maskAmount("1 234,56 €", false)).toBe("1 234,56 €");
  });

  it("substitue une chaîne de longueur fixe, quel que soit le montant", () => {
    /*
      C'est tout l'enjeu : un masque proportionnel au nombre de chiffres
      trahirait l'ordre de grandeur qu'on cherche justement à cacher.
    */
    expect(maskAmount("7 €", true)).toBe(MASKED_AMOUNT);
    expect(maskAmount("12 345 678,90 €", true)).toBe(MASKED_AMOUNT);
    expect(maskAmount("−980,00 $", true)).toBe(MASKED_AMOUNT);
  });

  it("s'ouvre en clair par défaut et retient la bascule", () => {
    expect(loadAmountsHidden()).toBe(false);
    saveAmountsHidden(true);
    expect(loadAmountsHidden()).toBe(true);
    saveAmountsHidden(false);
    expect(loadAmountsHidden()).toBe(false);
  });
});

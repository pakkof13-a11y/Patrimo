import { describe, expect, it } from "vitest";
import {
  pathToTab,
  pathnameToTab,
  tabToPath,
} from "@/app/lib/types/tab-routes";
import { MAIN_TAB_IDS, isMainTab } from "@/app/lib/types/ui";

describe("tab-routes", () => {
  it("tabToPath covers primary views", () => {
    expect(tabToPath("dashboard")).toBe("/dashboard");
    expect(tabToPath("holdings")).toBe("/positions");
    // `securities` porte PEA et CTO depuis leur fusion : c'est lui qui a une
    // URL canonique, pas deux onglets d'enveloppe disparus.
    expect(tabToPath("securities")).toBe("/pea-cto");
    expect(tabToPath("transactions")).toBe("/transactions");
    expect(tabToPath("fiscal")).toBe("/fiscalite");
    expect(tabToPath("platforms")).toBe("/plateformes");
    expect(tabToPath("liabilities")).toBe("/passifs");
  });

  it("pathToTab parses catch-all slugs", () => {
    expect(pathToTab(undefined)).toBe("dashboard");
    expect(pathToTab([])).toBe("dashboard");
    expect(pathToTab(["dashboard"])).toBe("dashboard");
    expect(pathToTab(["positions"])).toBe("holdings");
    // Les anciennes URL d'enveloppe mènent désormais à l'onglet dédié
    // « PEA & CTO », exactement comme `/positions/crypto` mène à Cryptos.
    // Une seule destination par sujet, et aucun lien existant ne casse.
    expect(pathToTab(["positions", "pea"])).toBe("securities");
    expect(pathToTab(["positions", "cto"])).toBe("securities");
    expect(pathToTab(["pea-cto"])).toBe("securities");
    expect(pathToTab(["titres"])).toBe("securities");
    // Anciennes URL de premier niveau. Elles résolvaient vers des onglets
    // `cto` / `pea` orphelins, dont l'URL canonique renvoyait ailleurs : un
    // rafraîchissement perdait le contexte.
    expect(pathToTab(["cto"])).toBe("securities");
    expect(pathToTab(["pea"])).toBe("securities");
    expect(pathToTab(["compte-titres"])).toBe("securities");
    expect(pathToTab(["transactions"])).toBe("transactions");
    expect(pathToTab(["fiscalite"])).toBe("fiscal");
    expect(pathToTab(["plateformes"])).toBe("platforms");
    // `/comptes` était l'URL canonique avant que le vocabulaire ne soit fixé :
    // « compte » désigne une entité réelle, pas un établissement. L'ancienne
    // forme continue de résoudre — les favoris ne cassent pas.
    expect(pathToTab(["comptes"])).toBe("platforms");
    expect(pathToTab(["mes-comptes"])).toBe("platforms");
    expect(pathToTab(["platforms"])).toBe("platforms");
    expect(pathToTab(["passifs"])).toBe("liabilities");
  });

  /**
   * Symétrie exhaustive.
   *
   * L'ancienne version de ce test énumérait dix onglets choisis à la main et
   * ratait précisément les deux qui étaient cassés. Parcourir `MAIN_TAB_IDS`
   * garantit qu'un onglet ajouté demain est couvert sans qu'on y pense.
   */
  it("chaque onglet revient sur lui-même par son URL canonique", () => {
    for (const tab of MAIN_TAB_IDS) {
      const path = tabToPath(tab);
      expect(
        pathnameToTab(path),
        `${tab} → ${path} → ${pathnameToTab(path)}`
      ).toBe(tab);
    }
  });

  it("MAIN_TAB_IDS couvre toutes les valeurs de MainTab", () => {
    /*
      `assurance-vie` manquait à cette liste : `isMainTab` répondait faux pour
      un onglet bien réel. C'est le même écart de recensement qui avait laissé
      `cto` et `pea` survivre à leur fusion.
    */
    for (const tab of MAIN_TAB_IDS) expect(isMainTab(tab)).toBe(true);
    expect(isMainTab("assurance-vie")).toBe(true);
    expect(isMainTab("securities")).toBe(true);
    // Retirés du modèle : plus aucun onglet ne les porte.
    expect(isMainTab("cto")).toBe(false);
    expect(isMainTab("pea")).toBe(false);
  });

  it("pathnameToTab ignores query/hash", () => {
    expect(pathnameToTab("/positions/pea?x=1#y")).toBe("securities");
  });
});

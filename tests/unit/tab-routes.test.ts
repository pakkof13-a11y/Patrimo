import { describe, expect, it } from "vitest";
import {
  pathToTab,
  pathnameToTab,
  tabToPath,
} from "@/app/lib/types/tab-routes";

describe("tab-routes", () => {
  it("tabToPath covers primary views", () => {
    expect(tabToPath("dashboard")).toBe("/dashboard");
    expect(tabToPath("holdings")).toBe("/positions");
    expect(tabToPath("pea")).toBe("/positions/pea");
    expect(tabToPath("transactions")).toBe("/transactions");
    expect(tabToPath("fiscal")).toBe("/fiscalite");
    expect(tabToPath("platforms")).toBe("/comptes");
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
    expect(pathToTab(["transactions"])).toBe("transactions");
    expect(pathToTab(["fiscalite"])).toBe("fiscal");
    expect(pathToTab(["plateformes"])).toBe("platforms");
    expect(pathToTab(["comptes"])).toBe("platforms");
    expect(pathToTab(["mes-comptes"])).toBe("platforms");
    expect(pathToTab(["passifs"])).toBe("liabilities");
  });

  it("pathnameToTab round-trips", () => {
    for (const tab of [
      "dashboard",
      "holdings",
      "securities",
      "crypto",
      "transactions",
      "platforms",
      "liabilities",
      "banques",
      "epargne-salariale",
      "alternatifs",
    ] as const) {
      const path = tabToPath(tab);
      expect(pathnameToTab(path)).toBe(tab);
    }
  });

  it("pathnameToTab ignores query/hash", () => {
    expect(pathnameToTab("/positions/pea?x=1#y")).toBe("securities");
  });
});

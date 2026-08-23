import { beforeEach, describe, expect, it } from "vitest";
import {
  PRIMARY_NAV,
  isMainTab,
  isPositionsTab,
} from "@/app/lib/types/ui";
import {
  ENVELOPE_SELECT_OPTIONS,
  envelopeParamToTab,
  tabToEnvelopeParam,
} from "@/app/lib/types/nav-groups";
import { DIRECT_TOP, NAV_SECTIONS } from "@/components/layout/app-sidebar";
import {
  isUserActivated,
  shouldShowOnboarding,
} from "@/components/onboarding/getting-started";
import {
  ONBOARDING_DISMISS_KEY,
  ONBOARDING_SESSION_DISMISS_KEY,
  ONBOARDING_SHOW_EVERY_START_KEY,
  loadOnboardingDismissState,
  saveSessionPref,
  saveUiPref,
} from "@/app/lib/ui-preferences";

describe("navigation", () => {
  const allIds = [
    ...DIRECT_TOP.map((e) => e.id),
    ...NAV_SECTIONS.flatMap((g) => g.items.map((i) => i.id)),
  ];

  it("les quatre familles couvrent tous les modules, sans inventer de page", () => {
    /*
      Ces tests portent sur la structure **réellement rendue**. Ils visaient
      auparavant `NAV_GROUPS`, une seconde description de la navigation que
      rien n'affichait — elle a donc été retirée.
    */
    for (const id of [
      "dashboard",
      "holdings",
      "securities",
      "banques",
      "assurance-vie",
      "immobilier",
      "crypto",
      "epargne-salariale",
      "alternatifs",
      "liabilities",
      "trading",
      "transactions",
      "platforms",
      "fiscal",
    ]) {
      expect(allIds).toContain(id);
    }
    // Onglets retirés du modèle au chantier CTO/PEA : plus rien ne doit les
    // proposer.
    expect(allIds).not.toContain("cto");
    expect(allIds).not.toContain("pea");
  });

  it("aucune entrée n'apparaît deux fois", () => {
    // Deux emplacements pour un même écran feraient s'allumer deux entrées.
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("le classement suit l'effet sur le patrimoine net", () => {
    /*
      C'est le critère du regroupement, et le seul qui rende la barre lisible :
      un avoir s'ajoute, un engagement non. Trading est un engagement — une
      position à levier ne pèse que par sa marge et son P&L latent.
    */
    const bySection = Object.fromEntries(
      NAV_SECTIONS.map((g) => [g.id, g.items.map((i) => i.id)])
    );
    expect(bySection.avoirs).toContain("holdings");
    expect(bySection.avoirs).toContain("securities");
    expect(bySection.engagements).toEqual(
      expect.arrayContaining(["liabilities", "trading"])
    );
    expect(bySection.avoirs).not.toContain("trading");
    expect(bySection.suivi).toEqual(
      expect.arrayContaining(["transactions", "platforms", "fiscal"])
    );
  });

  it("PEA & CTO reste une sous-vue du portefeuille", () => {
    // Consolidé au chantier précédent : pas de retour aux onglets CTO / PEA.
    const avoirs = NAV_SECTIONS.find((g) => g.id === "avoirs")!;
    const ids = avoirs.items.map((i) => i.id);
    expect(ids.indexOf("securities")).toBe(ids.indexOf("holdings") + 1);
  });

  it("la navigation ne parle jamais de « compte » pour une plateforme", () => {
    // Vocabulaire fixé au chantier terminologie.
    const labels = [
      ...DIRECT_TOP.map((e) => e.label),
      ...NAV_SECTIONS.flatMap((g) => [g.title, ...g.items.map((i) => i.label)]),
    ];
    expect(labels).toContain("Plateformes");
    expect(labels.filter((l) => /compte/i.test(l))).toEqual([]);
  });

  it("PRIMARY_NAV still lists top items for compat", () => {
    const ids = PRIMARY_NAV.map((x) => x.id);
    expect(ids).toContain("holdings");
    expect(ids).toContain("dashboard");
  });

  it("isPositionsTab", () => {
    expect(isPositionsTab("holdings")).toBe(true);
    // `av` reste une vue filtrée du tableau Positions ; `pea` et `cto` n'en
    // sont plus — ils ont leur propre écran, « PEA & CTO ».
    expect(isPositionsTab("av")).toBe(true);
    expect(isPositionsTab("securities")).toBe(false);
    expect(isPositionsTab("dashboard")).toBe(false);
  });

  it("isMainTab guards storage", () => {
    expect(isMainTab("holdings")).toBe(true);
    expect(isMainTab("nope")).toBe(false);
  });
});

describe("envelope select options", () => {
  it("maps param ↔ tab", () => {
    expect(envelopeParamToTab("av")).toBe("av");
    expect(envelopeParamToTab("")).toBe("holdings");
    expect(tabToEnvelopeParam("av")).toBe("av");
    expect(tabToEnvelopeParam("holdings")).toBe("");
    // `crypto`, comme `immobilier`, a son onglet de premier niveau : il n'a
    // plus de paramètre d'enveloppe, la fonction retombe donc sur "".
    expect(tabToEnvelopeParam("crypto")).toBe("");
    // Même chose pour le PEA et le compte-titres depuis l'onglet « PEA & CTO ».
    expect(tabToEnvelopeParam("securities")).toBe("");
  });

  it("lists only envelopes that have no dedicated tab", () => {
    const labels = ENVELOPE_SELECT_OPTIONS.map((o) => o.label);
    expect(labels[0]).toMatch(/Toutes les enveloppes/i);
    expect(labels).toEqual(
      expect.arrayContaining(["Assurance-vie", "CFD"])
    );
    // PEA et compte-titres ont leur onglet de premier niveau : les laisser ici
    // ferait quitter la page Positions depuis un sélecteur censé n'en filtrer
    // que le tableau — même raison qu'immobilier et crypto avant eux.
    expect(labels).not.toContain("PEA");
    expect(labels).not.toContain("Compte-titres");
  });
});

describe("shouldShowOnboarding", () => {
  it("shows full when empty", () => {
    expect(
      shouldShowOnboarding({
        hasPlatforms: false,
        hasHoldings: false,
        hasTransactions: false,
      })
    ).toBe(true);
  });

  it("hides when dismissed even if not activated", () => {
    expect(
      shouldShowOnboarding({
        hasPlatforms: false,
        hasHoldings: false,
        hasTransactions: false,
        dismissed: true,
      })
    ).toBe(false);
  });

  it("hides when activated and dismissed", () => {
    expect(
      shouldShowOnboarding({
        hasPlatforms: true,
        hasHoldings: true,
        hasTransactions: true,
        dismissed: true,
      })
    ).toBe(false);
  });

  it("shows when activated and not dismissed", () => {
    expect(
      shouldShowOnboarding({
        hasPlatforms: true,
        hasHoldings: true,
        hasTransactions: true,
        dismissed: false,
      })
    ).toBe(true);
  });

  it("forceShow overrides dismiss", () => {
    expect(
      shouldShowOnboarding({
        hasPlatforms: true,
        hasHoldings: true,
        hasTransactions: true,
        dismissed: true,
        forceShow: true,
      })
    ).toBe(true);
  });

  it("isUserActivated", () => {
    expect(
      isUserActivated({
        hasPlatforms: false,
        hasHoldings: false,
        hasTransactions: false,
      })
    ).toBe(false);
    expect(
      isUserActivated({
        hasPlatforms: true,
        hasHoldings: false,
        hasTransactions: false,
      })
    ).toBe(true);
  });
});

describe("loadOnboardingDismissState", () => {
  const PREFIX = "patrimo.ui.";
  let store: Record<string, string>;
  let session: Record<string, string>;

  function makeStorage(map: Record<string, string>): Storage {
    return {
      get length() {
        return Object.keys(map).length;
      },
      clear() {
        for (const k of Object.keys(map)) delete map[k];
      },
      getItem(key: string) {
        return map[key] ?? null;
      },
      setItem(key: string, value: string) {
        map[key] = String(value);
      },
      removeItem(key: string) {
        delete map[key];
      },
      key(i: number) {
        return Object.keys(map)[i] ?? null;
      },
    };
  }

  beforeEach(() => {
    store = {};
    session = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: makeStorage(store),
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: makeStorage(session),
      configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: globalThis,
      configurable: true,
    });
  });

  it("shows help by default (no storage)", () => {
    expect(loadOnboardingDismissState()).toEqual({
      dismissed: false,
      showEveryStart: true,
    });
  });

  it("ignores legacy permanent dismiss when show every start is default", () => {
    saveUiPref(ONBOARDING_DISMISS_KEY, true);
    const state = loadOnboardingDismissState();
    expect(state.dismissed).toBe(false);
    expect(state.showEveryStart).toBe(true);
    expect(store[PREFIX + ONBOARDING_DISMISS_KEY]).toBe("false");
  });

  it("ignores session dismiss when show every start (F5 must re-show help)", () => {
    saveSessionPref(ONBOARDING_SESSION_DISMISS_KEY, true);
    const state = loadOnboardingDismissState();
    expect(state.dismissed).toBe(false);
    // flag session purgé
    expect(session[PREFIX + ONBOARDING_SESSION_DISMISS_KEY]).toBeUndefined();
  });

  it("honors permanent when show every start is off", () => {
    saveUiPref(ONBOARDING_SHOW_EVERY_START_KEY, false);
    saveUiPref(ONBOARDING_DISMISS_KEY, true);
    expect(loadOnboardingDismissState()).toEqual({
      dismissed: true,
      showEveryStart: false,
    });
  });
});

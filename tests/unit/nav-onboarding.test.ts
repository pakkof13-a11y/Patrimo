import { beforeEach, describe, expect, it } from "vitest";
import {
  PRIMARY_NAV,
  isMainTab,
  isPositionsTab,
} from "@/app/lib/types/ui";
import {
  ENVELOPE_SELECT_OPTIONS,
  NAV_GROUPS,
  envelopeParamToTab,
  tabToEnvelopeParam,
} from "@/app/lib/types/nav-groups";
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

describe("nav groups", () => {
  it("NAV_GROUPS covers core tabs without inventing pages", () => {
    const ids = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toContain("dashboard");
    expect(ids).toContain("holdings");
    expect(ids).toContain("transactions");
    expect(ids).toContain("fiscal");
    expect(ids).not.toContain("cto"); // enveloppe hors nav primaire
  });

  it("Sources is a multi-item group (Banques + Mes plateformes)", () => {
    const sources = NAV_GROUPS.find((g) => g.id === "sources");
    expect(sources).toBeDefined();
    // Libellé produit court : « Sources » (ex. « Comptes et sources »)
    expect(sources!.label).toBe("Sources");
    expect(sources!.items.length).toBeGreaterThan(1);
    expect(sources!.items.map((i) => i.id)).toEqual(
      expect.arrayContaining(["banques", "platforms"])
    );
  });

  it("PRIMARY_NAV still lists top items for compat", () => {
    const ids = PRIMARY_NAV.map((x) => x.id);
    expect(ids).toContain("holdings");
    expect(ids).toContain("dashboard");
  });

  it("isPositionsTab", () => {
    expect(isPositionsTab("holdings")).toBe(true);
    expect(isPositionsTab("pea")).toBe(true);
    expect(isPositionsTab("dashboard")).toBe(false);
  });

  it("isMainTab guards storage", () => {
    expect(isMainTab("holdings")).toBe(true);
    expect(isMainTab("nope")).toBe(false);
  });
});

describe("envelope select options", () => {
  it("maps param ↔ tab", () => {
    expect(envelopeParamToTab("pea")).toBe("pea");
    expect(envelopeParamToTab("")).toBe("holdings");
    expect(tabToEnvelopeParam("crypto")).toBe("crypto");
    expect(tabToEnvelopeParam("holdings")).toBe("");
  });

  it("lists all envelopes with Toutes", () => {
    const labels = ENVELOPE_SELECT_OPTIONS.map((o) => o.label);
    expect(labels[0]).toMatch(/Toutes les enveloppes/i);
    expect(labels).toEqual(
      expect.arrayContaining(["PEA", "CFD", "Compte-titres"])
    );
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

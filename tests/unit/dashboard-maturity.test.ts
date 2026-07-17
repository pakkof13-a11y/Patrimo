import { describe, expect, it } from "vitest";
import {
  dashboardBlocksFor,
  onboardingStepCompletion,
  resolveDashboardMaturity,
  toOnboardingSignals,
} from "@/app/lib/dashboard/maturity";

describe("resolveDashboardMaturity", () => {
  it("empty when no platforms, txs, holdings", () => {
    expect(
      resolveDashboardMaturity({
        platformCount: 0,
        transactionCount: 0,
        holdingCount: 0,
      })
    ).toBe("empty");
  });

  it("setup when only platforms", () => {
    expect(
      resolveDashboardMaturity({
        platformCount: 1,
        transactionCount: 0,
        holdingCount: 0,
      })
    ).toBe("setup");
  });

  it("setup when few cash txs without holdings", () => {
    expect(
      resolveDashboardMaturity({
        platformCount: 1,
        transactionCount: 2,
        holdingCount: 0,
      })
    ).toBe("setup");
  });

  it("active with transactions and holdings", () => {
    expect(
      resolveDashboardMaturity({
        platformCount: 2,
        transactionCount: 5,
        holdingCount: 3,
      })
    ).toBe("active");
  });

  it("active with enough cash-only journal", () => {
    expect(
      resolveDashboardMaturity({
        platformCount: 1,
        transactionCount: 3,
        holdingCount: 0,
      })
    ).toBe("active");
  });
});

describe("dashboardBlocksFor", () => {
  it("empty hides analytics density", () => {
    const b = dashboardBlocksFor("empty");
    expect(b.showKpiStrip).toBe(false);
    expect(b.showOnboardingHero).toBe(true);
    expect(b.showQuickActions).toBe(false);
    expect(b.showEvolutionChart).toBe(false);
    expect(b.showNewsMacro).toBe(false);
  });

  it("active shows full cockpit with quick actions", () => {
    const b = dashboardBlocksFor("active");
    expect(b.showKpiStrip).toBe(true);
    expect(b.kpiSmartFilter).toBe(true);
    expect(b.showOnboardingHero).toBe(false);
    expect(b.showQuickActions).toBe(true);
    expect(b.showHelpToggle).toBe(false);
    expect(b.showEvolutionChart).toBe(true);
    expect(b.showNewsMacro).toBe(true);
  });
});

describe("onboardingStepCompletion", () => {
  it("tracks 3 steps", () => {
    const s = toOnboardingSignals({
      platformCount: 1,
      transactionCount: 0,
      holdingCount: 0,
    });
    const p = onboardingStepCompletion(s);
    expect(p.doneCount).toBe(1);
    expect(p.percent).toBe(33);
    expect(p.platform).toBe(true);
    expect(p.data).toBe(false);
  });
});

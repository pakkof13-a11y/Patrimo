import { describe, expect, it } from "vitest";
import { monthsUntil, loanProgressPct } from "../../app/lib/alternatives/crowdlending";
import { summarizePrivateEquity } from "../../app/lib/alternatives/private-equity";
import type { PrivateEquityDto } from "../../app/lib/alternatives/types";
import { PLATFORM_PRESETS } from "../../app/lib/platforms/presets";

describe("crowdlending monthsUntil / progress", () => {
  it("counts months remaining", () => {
    const now = new Date("2024-01-15");
    const mat = new Date("2024-07-15");
    expect(monthsUntil(mat, now)).toBe(6);
  });

  it("negative when past maturity", () => {
    const now = new Date("2025-01-01");
    const mat = new Date("2024-06-01");
    expect(monthsUntil(mat, now)).toBeLessThan(0);
  });

  it("progress between 0 and 100", () => {
    const start = new Date("2024-01-01");
    const mat = new Date("2024-12-31");
    const mid = new Date("2024-07-01");
    const p = loanProgressPct(start, mat, mid);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0);
    expect(p!).toBeLessThan(100);
  });
});

describe("private equity MOIC", () => {
  it("summarizes invested / nav / avg moic", () => {
    const lines: PrivateEquityDto[] = [
      {
        id: "1",
        companyName: "A",
        sector: null,
        peType: "DIRECT",
        shares: "10",
        acquisitionPricePerShare: "100",
        investmentDate: null,
        currentNav: "2000",
        currency: "EUR",
        notes: null,
        investedTotal: "1000.00",
        moic: "2.00",
        unrealizedPnl: "1000.00",
        unrealizedPnlPct: "100.00",
      },
      {
        id: "2",
        companyName: "B",
        sector: null,
        peType: "DIRECT",
        shares: "5",
        acquisitionPricePerShare: "200",
        investmentDate: null,
        currentNav: "500",
        currency: "EUR",
        notes: null,
        investedTotal: "1000.00",
        moic: "0.50",
        unrealizedPnl: "-500.00",
        unrealizedPnlPct: "-50.00",
      },
    ];
    const s = summarizePrivateEquity(lines);
    expect(s.totalInvested).toBe("2000.00");
    expect(s.totalNav).toBe("2500.00");
    expect(s.avgMoic).toBe(1.25);
    expect(s.lineCount).toBe(2);
  });
});

describe("platform presets uniqueness", () => {
  it("has unique keys", () => {
    const keys = PLATFORM_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("COURTIER en bourse and ASSURANCE_VIE and CFD are distinct keys", () => {
    const byType = (t: string) => PLATFORM_PRESETS.filter((p) => p.type === t);
    expect(byType("COURTIER").length).toBeGreaterThan(5);
    expect(byType("ASSURANCE_VIE").length).toBeGreaterThan(10);
    expect(byType("BROKER_CFD").length).toBeGreaterThan(5);
  });
});

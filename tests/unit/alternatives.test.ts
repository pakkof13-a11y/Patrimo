import { describe, expect, it } from "vitest";
import { Prisma } from "../../app/lib/prisma-client/client";
import {
  monthsUntil,
  loanProgressPct,
  summarizeCrowdlending,
} from "../../app/lib/alternatives/crowdlending";
import {
  isNavStale,
  mapRow,
  summarizePrivateEquity,
} from "../../app/lib/alternatives/private-equity";
import {
  buildAlternativesShortAlerts,
  type CrowdlendingDto,
  type PrivateEquityDto,
} from "../../app/lib/alternatives/types";
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

function clLine(overrides: Partial<CrowdlendingDto> = {}): CrowdlendingDto {
  return {
    id: "cl-1",
    projectName: "Projet",
    platform: "October",
    capitalInvested: "1000.00",
    annualYieldPercent: "8",
    durationMonths: 24,
    repaymentType: "IN_FINE",
    startDate: null,
    maturityDate: null,
    status: "ACTIVE",
    currency: "EUR",
    notes: null,
    monthsRemaining: null,
    progressPct: null,
    remainingCapital: "0",
    effectiveRemainingCapital: "1000.00",
    remainingCapitalIsDerived: true,
    interestReceivedToDate: "0",
    paymentFrequency: "MONTHLY",
    nextPaymentDate: null,
    riskGrade: null,
    expectedTotalInterest: "160.00",
    ...overrides,
  };
}

describe("summarizeCrowdlending", () => {
  it("computes weighted average yield over active capital only", () => {
    const lines = [
      clLine({
        id: "1",
        capitalInvested: "1000",
        annualYieldPercent: "10",
        effectiveRemainingCapital: "1000.00",
        status: "ACTIVE",
      }),
      clLine({
        id: "2",
        capitalInvested: "3000",
        annualYieldPercent: "6",
        effectiveRemainingCapital: "3000.00",
        status: "ACTIVE",
      }),
      // Remboursé : ne doit pas peser sur le rendement pondéré actif.
      clLine({
        id: "3",
        capitalInvested: "5000",
        annualYieldPercent: "20",
        effectiveRemainingCapital: "0",
        remainingCapitalIsDerived: false,
        status: "REPAID",
      }),
    ];
    const s = summarizeCrowdlending(lines);
    // (1000*10 + 3000*6) / (1000+3000) = 7
    expect(s.weightedAverageYield).toBe(7);
    expect(s.projectedAnnualIncome).toBe("280.00");
    expect(s.remainingCapitalTotal).toBe("4000.00");
    expect(s.activeCapital).toBe("4000.00");
    expect(s.totalCapital).toBe("9000.00");
  });

  it("sums interest received regardless of status", () => {
    const lines = [
      clLine({ id: "1", interestReceivedToDate: "50" }),
      clLine({ id: "2", interestReceivedToDate: "25", status: "REPAID" }),
    ];
    const s = summarizeCrowdlending(lines);
    expect(s.interestReceivedTotal).toBe("75.00");
  });

  it("weighted yield is null with no active capital", () => {
    const lines = [
      clLine({ id: "1", status: "REPAID", effectiveRemainingCapital: "0" }),
    ];
    const s = summarizeCrowdlending(lines);
    expect(s.weightedAverageYield).toBeNull();
    expect(s.projectedAnnualIncome).toBe("0.00");
  });

  it("soonCount ne compte que les prêts ACTIVE à échéance entre 0 et 3 mois", () => {
    const lines = [
      clLine({ id: "1", status: "ACTIVE", monthsRemaining: 2 }), // soon
      clLine({ id: "2", status: "ACTIVE", monthsRemaining: 3 }), // soon (borne incluse)
      clLine({ id: "3", status: "ACTIVE", monthsRemaining: 4 }), // trop loin
      clLine({ id: "4", status: "ACTIVE", monthsRemaining: -1 }), // déjà dépassé
      clLine({ id: "5", status: "LATE", monthsRemaining: 1 }), // pas ACTIVE
      clLine({ id: "6", status: "ACTIVE", monthsRemaining: null }), // pas d'échéance connue
    ];
    const s = summarizeCrowdlending(lines);
    expect(s.soonCount).toBe(2);
  });

  it("soonCount à 0 quand aucun prêt n'est proche de l'échéance", () => {
    const lines = [
      clLine({ id: "1", status: "ACTIVE", monthsRemaining: 12 }),
      clLine({ id: "2", status: "REPAID", monthsRemaining: 0 }),
    ];
    expect(summarizeCrowdlending(lines).soonCount).toBe(0);
  });
});

/** Construit une ligne Prisma PrivateEquityPosition minimale pour mapRow. */
function peRow(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    id: "pe-1",
    companyName: "Acme",
    sector: null,
    peType: "DIRECT",
    shares: new Prisma.Decimal(10),
    acquisitionPricePerShare: new Prisma.Decimal(100),
    investmentDate: null,
    currentNav: new Prisma.Decimal(2000),
    currency: "EUR",
    notes: null,
    committedCapital: new Prisma.Decimal(0),
    calledCapital: new Prisma.Decimal(0),
    distributionsReceived: new Prisma.Decimal(0),
    ownershipPercent: null,
    expectedExitDate: null,
    vehicleName: null,
    round: null,
  };
  return { ...base, ...overrides } as Parameters<typeof mapRow>[0];
}

describe("private-equity mapRow — dpi / rvpi / tvpi / pnl", () => {
  it("falls back to shares × PRU when calledCapital is 0", () => {
    const dto = mapRow(peRow({ calledCapital: new Prisma.Decimal(0) }));
    expect(dto.calledCapitalIsDerived).toBe(true);
    // invested = 10 * 100 = 1000, nav = 2000 → tvpi = 2000/1000 = 2
    expect(dto.tvpi).toBe("2.0000");
    expect(dto.rvpi).toBe("2.0000");
    expect(dto.dpi).toBe("0.0000");
    expect(dto.unrealizedPnl).toBe("1000.00");
  });

  it("uses the stored calledCapital when non-zero, not the derived one", () => {
    const dto = mapRow(
      peRow({
        shares: new Prisma.Decimal(10),
        acquisitionPricePerShare: new Prisma.Decimal(100), // invested = 1000
        calledCapital: new Prisma.Decimal(500), // appel partiel réel
        currentNav: new Prisma.Decimal(600),
      })
    );
    expect(dto.calledCapitalIsDerived).toBe(false);
    // tvpi = 600 / 500 = 1.2, pas 600/1000
    expect(dto.tvpi).toBe("1.2000");
  });

  it("dpi can exceed 1 when distributions exceed called capital", () => {
    const dto = mapRow(
      peRow({
        calledCapital: new Prisma.Decimal(1000),
        distributionsReceived: new Prisma.Decimal(1500),
        currentNav: new Prisma.Decimal(200),
      })
    );
    expect(dto.dpi).toBe("1.5000");
    // tvpi = (200 + 1500) / 1000 = 1.7
    expect(dto.tvpi).toBe("1.7000");
  });

  it("returns null ratios rather than a division by zero when no capital at all is at stake", () => {
    const dto = mapRow(
      peRow({
        shares: new Prisma.Decimal(0),
        acquisitionPricePerShare: new Prisma.Decimal(0),
        calledCapital: new Prisma.Decimal(0),
        currentNav: new Prisma.Decimal(0),
        distributionsReceived: new Prisma.Decimal(0),
      })
    );
    expect(dto.dpi).toBeNull();
    expect(dto.rvpi).toBeNull();
    expect(dto.tvpi).toBeNull();
    // moic est l'alias rétrocompatible de tvpi : jamais null, "0.00" ici.
    expect(dto.moic).toBe("0.00");
  });

  it("moic mirrors tvpi once distributions are involved", () => {
    const dto = mapRow(
      peRow({
        calledCapital: new Prisma.Decimal(1000),
        distributionsReceived: new Prisma.Decimal(300),
        currentNav: new Prisma.Decimal(900),
      })
    );
    expect(dto.moic).toBe(Number(dto.tvpi).toFixed(2));
  });
});

function peLine(overrides: Partial<PrivateEquityDto> = {}): PrivateEquityDto {
  return {
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
    committedCapital: "0",
    calledCapital: "0",
    calledCapitalIsDerived: true,
    distributionsReceived: "0",
    dpi: "0.0000",
    rvpi: "2.0000",
    tvpi: "2.0000",
    ownershipPercent: null,
    expectedExitDate: null,
    vehicleName: null,
    round: null,
    navUpdatedAt: null,
    ...overrides,
  };
}

describe("private equity summary", () => {
  it("summarizes invested / nav / avg moic", () => {
    const lines: PrivateEquityDto[] = [
      peLine({
        id: "1",
        shares: "10",
        acquisitionPricePerShare: "100",
        currentNav: "2000",
        investedTotal: "1000.00",
        moic: "2.00",
        unrealizedPnl: "1000.00",
        unrealizedPnlPct: "100.00",
      }),
      peLine({
        id: "2",
        shares: "5",
        acquisitionPricePerShare: "200",
        currentNav: "500",
        investedTotal: "1000.00",
        moic: "0.50",
        unrealizedPnl: "-500.00",
        unrealizedPnlPct: "-50.00",
      }),
    ];
    const s = summarizePrivateEquity(lines);
    expect(s.totalInvested).toBe("2000.00");
    expect(s.totalNav).toBe("2500.00");
    expect(s.avgMoic).toBe(1.25);
    expect(s.lineCount).toBe(2);
  });

  it("aggregates called capital / distributions and derives avg dpi/rvpi/tvpi", () => {
    const lines: PrivateEquityDto[] = [
      // Ligne 1 : calledCapital non renseigné → repli sur investedTotal (1000)
      peLine({
        id: "1",
        investedTotal: "1000.00",
        currentNav: "2000",
        calledCapital: "0",
        calledCapitalIsDerived: true,
        distributionsReceived: "0",
      }),
      // Ligne 2 : calledCapital saisi (500), distincte de investedTotal (1000)
      peLine({
        id: "2",
        investedTotal: "1000.00",
        currentNav: "600",
        calledCapital: "500",
        calledCapitalIsDerived: false,
        distributionsReceived: "200",
      }),
    ];
    const s = summarizePrivateEquity(lines);
    // totalCalledCapital = 1000 (repli ligne 1) + 500 (saisi ligne 2) = 1500
    expect(s.totalCalledCapital).toBe("1500.00");
    expect(s.totalDistributions).toBe("200.00");
    // totalNav = 2000 + 600 = 2600 ; avgRvpi = 2600 / 1500
    expect(s.avgRvpi).toBeCloseTo(2600 / 1500, 4);
    // avgDpi = 200 / 1500
    expect(s.avgDpi).toBeCloseTo(200 / 1500, 4);
    // avgTvpi = (2600 + 200) / 1500
    expect(s.avgTvpi).toBeCloseTo(2800 / 1500, 4);
  });

  it("avg dpi/rvpi/tvpi are null when no capital was ever called", () => {
    const lines: PrivateEquityDto[] = [
      peLine({
        id: "1",
        investedTotal: "0.00",
        currentNav: "0",
        calledCapital: "0",
        calledCapitalIsDerived: true,
        distributionsReceived: "0",
      }),
    ];
    const s = summarizePrivateEquity(lines);
    expect(s.totalCalledCapital).toBe("0.00");
    expect(s.avgDpi).toBeNull();
    expect(s.avgRvpi).toBeNull();
    expect(s.avgTvpi).toBeNull();
  });
});

describe("isNavStale", () => {
  const now = new Date("2025-06-15");

  it("stale quand navUpdatedAt est absent (null)", () => {
    expect(isNavStale(null, now)).toBe(true);
  });

  it("stale quand navUpdatedAt est une date invalide", () => {
    expect(isNavStale("not-a-date", now)).toBe(true);
  });

  it("pas stale à exactement 6 mois", () => {
    expect(isNavStale("2024-12-15", now)).toBe(false);
  });

  it("stale au-delà de 6 mois", () => {
    expect(isNavStale("2024-11-01", now)).toBe(true);
  });

  it("pas stale pour une mise à jour récente", () => {
    expect(isNavStale("2025-06-01", now)).toBe(false);
  });
});

describe("summarizePrivateEquity — staleNavCount", () => {
  const now = new Date("2025-06-15");

  it("compte les positions dont la NAV n'a pas été mise à jour depuis > 6 mois, ou jamais", () => {
    // Les dates de navUpdatedAt sont dérivées côté mapRow de `updatedAt` ; on
    // les fournit directement ici pour tester summarizePrivateEquity en isolation.
    const lines: PrivateEquityDto[] = [
      peLine({ id: "1", navUpdatedAt: "2025-06-01" }), // récent
      peLine({ id: "2", navUpdatedAt: "2024-10-01" }), // > 6 mois
      peLine({ id: "3", navUpdatedAt: null }), // jamais mis à jour
    ];
    expect(summarizePrivateEquity(lines, now).staleNavCount).toBe(2);
  });

  it("staleNavCount à 0 quand toutes les NAV sont récentes", () => {
    const lines: PrivateEquityDto[] = [
      peLine({ id: "1", navUpdatedAt: "2025-06-10" }),
      peLine({ id: "2", navUpdatedAt: "2025-01-01" }),
    ];
    expect(summarizePrivateEquity(lines, now).staleNavCount).toBe(0);
  });
});

describe("buildAlternativesShortAlerts", () => {
  const clSummaryBase = { byStatus: [], soonCount: 0 };
  const peSummaryBase = { staleNavCount: 0 };

  it("tableau vide quand aucune alerte", () => {
    expect(
      buildAlternativesShortAlerts(clSummaryBase, peSummaryBase)
    ).toEqual([]);
  });

  it("inclut cl-late / cl-default / cl-soon / pe-stale-nav quand présents", () => {
    const alerts = buildAlternativesShortAlerts(
      {
        byStatus: [
          { status: "LATE", label: "En retard", count: 2, capital: 100 },
          { status: "DEFAULT", label: "Défaut", count: 1, capital: 50 },
        ],
        soonCount: 3,
      },
      { staleNavCount: 4 }
    );
    expect(alerts).toEqual([
      { type: "cl-late", label: "Prêt(s) en retard", count: 2, sub: "crowdlending" },
      { type: "cl-default", label: "Prêt(s) en défaut", count: 1, sub: "crowdlending" },
      {
        type: "cl-soon",
        label: "Prêt(s) à échéance ≤ 3 mois",
        count: 3,
        sub: "crowdlending",
      },
      {
        type: "pe-stale-nav",
        label: "Position(s) PE — NAV non mise à jour depuis > 6 mois",
        count: 4,
        sub: "private-equity",
      },
    ]);
  });

  it("ne renvoie que les types réellement en alerte", () => {
    const alerts = buildAlternativesShortAlerts(
      { byStatus: [], soonCount: 1 },
      { staleNavCount: 0 }
    );
    expect(alerts).toEqual([
      {
        type: "cl-soon",
        label: "Prêt(s) à échéance ≤ 3 mois",
        count: 1,
        sub: "crowdlending",
      },
    ]);
  });
});

describe("platform presets uniqueness", () => {
  it("has unique keys", () => {
    const keys = PLATFORM_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("COURTIER en bourse and ASSURANCE_VIE and CFD are distinct keys", () => {
    const byType = (t: string) =>
      PLATFORM_PRESETS.filter((p) => p.types.includes(t as never));
    expect(byType("COURTIER").length).toBeGreaterThan(5);
    expect(byType("ASSURANCE_VIE").length).toBeGreaterThan(10);
    expect(byType("BROKER_CFD").length).toBeGreaterThan(5);
  });

  it("multi-types catalogue (Revolut, eToro) + absences (N26)", () => {
    const revolut = PLATFORM_PRESETS.find((p) => p.key === "REVOLUT");
    expect(revolut?.types).toEqual(
      expect.arrayContaining([
        "COURTIER",
        "EXCHANGE_CRYPTO",
        "BANQUE",
        "BROKER_CFD",
      ])
    );
    const etoro = PLATFORM_PRESETS.find((p) => p.key === "ETORO");
    expect(etoro?.types).toEqual(
      expect.arrayContaining(["COURTIER", "BROKER_CFD", "EXCHANGE_CRYPTO"])
    );
    expect(PLATFORM_PRESETS.some((p) => p.key === "N26")).toBe(false);
    expect(PLATFORM_PRESETS.some((p) => p.key === "BYBIT")).toBe(true);
    expect(PLATFORM_PRESETS.some((p) => p.key === "LEDGER")).toBe(true);
  });
});

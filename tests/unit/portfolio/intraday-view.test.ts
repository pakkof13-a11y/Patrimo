import { describe, expect, it } from "vitest";
import {
  dayBoundaryTicks,
  drawdownSummary,
  formatIntradayDay,
  formatIntradayStamp,
  formatIntradayTime,
  hasEstimatedPoint,
  periodDelta,
  toChartPoints,
  type IntradayApiExtremes,
  type IntradayApiPoint,
} from "@/app/lib/portfolio/intraday-view";

/**
 * La couche de mise en forme de la série intraday.
 *
 * Elle n'évalue rien : elle habille. Ces tests verrouillent surtout ce qu'elle
 * s'interdit — recalculer un extrême, altérer une valeur, transformer un point
 * estimé en observé.
 */

const point = (over: Partial<IntradayApiPoint> = {}): IntradayApiPoint => ({
  at: "2026-08-26T12:37:00.000Z",
  day: "2026-08-26",
  netWorth: 820_000,
  grossAssets: 900_000,
  liabilities: 80_000,
  cash: 10_000,
  securities: 500_000,
  crypto: 100_000,
  realEstate: 200_000,
  lifeInsurance: 50_000,
  alternatives: 40_000,
  employeeSavings: 0,
  otherAssets: 0,
  externalFlows: 0,
  status: "EXACT",
  estimatedComponents: [],
  ...over,
});

describe("5 — horodatage UTC affiché à Paris", () => {
  it("12:37 UTC devient 14:37 en heure d'été", () => {
    /*
      L'API rend de l'UTC ; l'utilisateur lit l'heure de Paris. C'est la seule
      conversion faite côté navigateur, et elle ne touche que le libellé.
    */
    expect(formatIntradayTime("2026-08-26T12:37:00.000Z")).toBe("14:37");
  });

  it("l'horodatage complet nomme le jour et l'heure", () => {
    expect(formatIntradayStamp("2026-08-26T12:37:00.000Z")).toBe(
      "26 août 2026 · 14:37"
    );
  });

  it("une heure d'hiver décale d'une heure seulement", () => {
    expect(formatIntradayTime("2026-01-15T12:37:00.000Z")).toBe("13:37");
  });

  it("un point de fin de journée UTC appartient au lendemain à Paris", () => {
    // 22 h 30 UTC = 00 h 30 le 27 à Paris : l'axe doit suivre le fuseau lu.
    expect(formatIntradayDay("2026-08-26T22:30:00.000Z")).toBe("27 août");
  });
});

describe("1 — points prêts pour le tracé", () => {
  it("l'horodatage devient une abscisse numérique, la valeur ne bouge pas", () => {
    const [p] = toChartPoints([point({ netWorth: 807_500 })]);
    expect(p!.t).toBe(new Date("2026-08-26T12:37:00.000Z").getTime());
    expect(p!.netWorth).toBe(807_500);
    expect(p!.timeLabel).toBe("14:37");
  });

  it("aucune valeur n'est arrondie ni transformée", () => {
    const source = [point({ netWorth: 819_999.37 }), point({ netWorth: 807_500.02 })];
    expect(toChartPoints(source).map((p) => p.netWorth)).toEqual([
      819_999.37, 807_500.02,
    ]);
  });
});

describe("axe temporel", () => {
  it("une graduation par changement de jour", () => {
    const pts = toChartPoints([
      point({ at: "2026-08-24T08:00:00.000Z" }),
      point({ at: "2026-08-24T14:00:00.000Z" }),
      point({ at: "2026-08-25T08:00:00.000Z" }),
      point({ at: "2026-08-25T16:00:00.000Z" }),
      point({ at: "2026-08-26T09:00:00.000Z" }),
    ]);
    const ticks = dayBoundaryTicks(pts);
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toBe(new Date("2026-08-24T08:00:00.000Z").getTime());
    expect(ticks[2]).toBe(new Date("2026-08-26T09:00:00.000Z").getTime());
  });

  it("une série vide n'a aucune graduation", () => {
    expect(dayBoundaryTicks([])).toEqual([]);
  });
});

describe("4 — repli, tel que l'API l'a mesuré", () => {
  const extremes: IntradayApiExtremes = {
    max: { at: "2026-08-26T08:00:00.000Z", value: 820_000 },
    min: { at: "2026-08-26T12:30:00.000Z", value: 807_500 },
    drawdownEur: 12_500,
    drawdownPct: 1.524,
    peakAt: "2026-08-26T08:00:00.000Z",
    troughAt: "2026-08-26T12:30:00.000Z",
    recoveredAt: null,
  };

  it("reprend le montant et le pourcentage sans les recalculer", () => {
    const d = drawdownSummary(extremes)!;
    expect(d.eur).toBe(12_500);
    expect(d.pct).toBe(1.524);
    expect(d.peakAt).toBe(extremes.peakAt);
    expect(d.troughAt).toBe(extremes.troughAt);
    expect(d.recovered).toBe(false);
  });

  it("signale une récupération quand l'API en rapporte une", () => {
    const d = drawdownSummary({
      ...extremes,
      recoveredAt: "2026-08-26T16:00:00.000Z",
    })!;
    expect(d.recovered).toBe(true);
  });

  it("aucun repli : rien à annoncer", () => {
    expect(drawdownSummary({ ...extremes, drawdownEur: 0 })).toBeNull();
  });

  it("sans extrêmes, rien n'est inventé", () => {
    expect(drawdownSummary(null)).toBeNull();
  });
});

describe("3 — statut estimé", () => {
  it("un seul point estimé suffit à le signaler", () => {
    expect(
      hasEstimatedPoint([point(), point({ status: "ESTIMATED" }), point()])
    ).toBe(true);
  });

  it("une série entièrement observée ne le signale pas", () => {
    expect(hasEstimatedPoint([point(), point()])).toBe(false);
  });

  it("le statut n'est jamais réécrit au passage", () => {
    const [p] = toChartPoints([
      point({ status: "ESTIMATED", estimatedComponents: ["crypto"] }),
    ]);
    expect(p!.status).toBe("ESTIMATED");
    expect(p!.estimatedComponents).toEqual(["crypto"]);
  });
});

describe("variation de la fenêtre", () => {
  it("différence entre le dernier et le premier point", () => {
    expect(
      periodDelta([point({ netWorth: 800_000 }), point({ netWorth: 820_000 })])
    ).toBe(20_000);
  });

  it("un seul point : aucune variation à annoncer", () => {
    expect(periodDelta([point()])).toBeNull();
  });

  it("série vide : rien", () => {
    expect(periodDelta([])).toBeNull();
  });
});

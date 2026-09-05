import { describe, expect, it } from "vitest";
import { compressDailyNavPoints } from "@/app/lib/portfolio/historical/daily-nav-compress";
import type { DailyNavPoint } from "@/app/lib/portfolio/historical/get-daily-nav";

/**
 * Compression aval de `daily-nav` — la borne « Tout » sur un patrimoine à
 * plateau (années d'écart entre deux acquisitions) ne doit pas coûter un
 * point par jour civil traversé.
 */

function base(day: string, over: Partial<DailyNavPoint> = {}): DailyNavPoint {
  return {
    day,
    nav: 0,
    status: "EXACT",
    externalFlows: 0,
    transactionFlow: 0,
    financierFlows: 0,
    listed: 0,
    financier: 0,
    brut: 0,
    net: 0,
    cash: 0,
    immobilier: 0,
    av: 0,
    alternatifs: 0,
    employeeSavings: 0,
    passifs: 0,
    priceOrigins: [],
    realizedPnl: 0,
    ledgerCashIncome: 0,
    unrealizedPnl: 0,
    byAssetClassAndEnvelope: {
      ACTIONS: { PEA: null, CTO: null, UNKNOWN: 0 },
      OBLIGATIONS: { PEA: 0, CTO: 0, UNKNOWN: 0 },
    },
    ...over,
  };
}

/** Suite de jours civils consécutifs, `YYYY-MM-DD`. */
function days(from: string, count: number): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  let t = Date.UTC(y!, m! - 1, d!, 12);
  for (let i = 0; i < count; i++) {
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
        dt.getUTCDate()
      ).padStart(2, "0")}`
    );
    t += 86_400_000;
  }
  return out;
}

describe("compressDailyNavPoints", () => {
  it("un plateau de plusieurs années est réduit à ses extrémités + un point par année", () => {
    // 1998-06-20 → 2000-06-20 : ~731 jours identiques (aucun flux).
    const span = days("1998-06-20", 731);
    const points = span.map((day) => base(day, { nav: 240, brut: 240 }));
    const out = compressDailyNavPoints(points);

    expect(out[0]!.day).toBe(span[0]);
    expect(out[out.length - 1]!.day).toBe(span[span.length - 1]);
    // Premier + dernier + un repère par année civile traversée (1999, 2000) :
    // très inférieur aux 731 jours d'origine.
    expect(out.length).toBeLessThan(10);
    expect(out.length).toBeGreaterThanOrEqual(4);
  });

  it("les 18 marches d'un patrimoine sont toutes conservées", () => {
    // Palier à 240 pendant 400 jours, puis saut à 1000 (acquisition) le
    // dernier jour.
    const plateau = days("2000-01-01", 400).map((day) =>
      base(day, { nav: 240, brut: 240 })
    );
    const after = days("2001-02-05", 5).map((day) =>
      base(day, { nav: 1000, brut: 1000 })
    );
    const out = compressDailyNavPoints([...plateau, ...after]);

    // Le dernier jour du palier bas et le premier jour du palier haut
    // encadrent l'acquisition — les deux doivent survivre.
    expect(out.some((p) => p.day === plateau[plateau.length - 1]!.day)).toBe(
      true
    );
    expect(out.some((p) => p.day === after[0]!.day)).toBe(true);
  });

  it("un jour à flux non nul n'est jamais comprimé, même à valeur inchangée", () => {
    const span = days("2010-01-01", 60).map((day) =>
      base(day, { nav: 500, brut: 500 })
    );
    // Un flux au milieu, sans que `nav` ne bouge (compensé côté marché).
    span[30] = base(span[30]!.day, {
      nav: 500,
      brut: 500,
      externalFlows: 1_000,
    });
    const out = compressDailyNavPoints(span);
    expect(out.some((p) => p.day === span[30]!.day)).toBe(true);
  });

  it("une tranche dense (chaque jour diffère) n'est jamais réduite", () => {
    const span = days("2020-01-01", 40).map((day, i) =>
      base(day, { nav: 100 + i, brut: 100 + i })
    );
    const out = compressDailyNavPoints(span);
    expect(out).toHaveLength(span.length);
  });

  it("une différence sur une seule poche hors du scope courant empêche la compression", () => {
    const span = days("2015-01-01", 10).map((day) => base(day, { nav: 100 }));
    // `nav` (le scope demandé) ne bouge pas, mais `alternatifs` bouge : la
    // journée n'est pas un vrai plateau, toutes les grandeurs publiées
    // doivent être identiques pour comprimer.
    span[5] = base(span[5]!.day, { nav: 100, alternatifs: 42 });
    const out = compressDailyNavPoints(span);
    expect(out.some((p) => p.day === span[5]!.day)).toBe(true);
    expect(out.some((p) => p.day === span[4]!.day)).toBe(true);
  });

  it("un passage UNKNOWN → PEA n'est pas un plateau, même si la NAV est plate", () => {
    const span = days("2024-01-01", 8).map((day) =>
      base(day, {
        nav: 100,
        brut: 100,
        listed: 100,
        byAssetClassAndEnvelope: {
          ACTIONS: { PEA: null, CTO: null, UNKNOWN: 100 },
          OBLIGATIONS: { PEA: 0, CTO: 0, UNKNOWN: 0 },
        },
      })
    );
    span[5] = base(span[5]!.day, {
      nav: 100,
      brut: 100,
      listed: 100,
      byAssetClassAndEnvelope: {
        ACTIONS: { PEA: 100, CTO: 0, UNKNOWN: 0 },
        OBLIGATIONS: { PEA: 0, CTO: 0, UNKNOWN: 0 },
      },
    });
    const out = compressDailyNavPoints(span);
    expect(out.some((p) => p.day === span[5]!.day)).toBe(true);
    expect(out.some((p) => p.day === span[4]!.day)).toBe(true);
    expect(
      out.find((p) => p.day === span[4]!.day)?.byAssetClassAndEnvelope.ACTIONS
        .UNKNOWN
    ).toBe(100);
  });

  it("ne modifie aucune valeur des points conservés", () => {
    const span = days("2018-01-01", 500).map((day, i) =>
      base(day, { nav: i % 3 === 0 ? 100 : 100 })
    );
    span[250] = base(span[250]!.day, { nav: 999 });
    const out = compressDailyNavPoints(span);
    const found = out.find((p) => p.day === span[250]!.day)!;
    expect(found.nav).toBe(999);
  });
});

import { describe, expect, it } from "vitest";
import { buildClassPeriodSeries } from "@/app/lib/portfolio/class-period-series";
import type { ClassDailyPnl } from "@/app/lib/portfolio/class-history";

function point(
  day: string,
  valueByClass: Record<string, number>,
  pnlByClass: Record<string, number> = {}
): ClassDailyPnl {
  return { day, valueByClass, pnlByClass, incompleteClasses: [] };
}

/**
 * Performance de classe sur une fenêtre.
 *
 * Le point de tout ce module : un versement n'est pas une performance. Les cas
 * ci-dessous fixent cette frontière, qui est précisément celle que la courbe
 * de valeur de marché ne tenait pas.
 */
describe("buildClassPeriodSeries", () => {
  it("cumule les P&L journaliers, en partant de zéro", () => {
    const series = buildClassPeriodSeries([
      point("2026-07-01", { ACTIONS: 1000 }),
      point("2026-07-02", { ACTIONS: 1050 }, { ACTIONS: 50 }),
      point("2026-07-03", { ACTIONS: 1020 }, { ACTIONS: -30 }),
    ]);
    const actions = series.get("ACTIONS")!;
    expect(actions.cumulative).toEqual([0, 50, 20]);
    expect(actions.pnl).toBe(20);
    // 20 € gagnés sur 1 000 € engagés.
    expect(actions.pct).toBeCloseTo(2, 6);
  });

  it("ne compte pas un versement comme un gain", () => {
    /*
      La valeur double d'un jour à l'autre, mais uniquement parce que 1 000 €
      ont été versés : aucun cours n'a bougé, la courbe doit rester plate et le
      rendement nul. C'est le défaut exact de la courbe de valeur de marché.
    */
    const series = buildClassPeriodSeries([
      point("2026-07-01", { CRYPTO: 1000 }),
      point("2026-07-02", { CRYPTO: 2000 }, {}),
      point("2026-07-03", { CRYPTO: 2000 }, {}),
    ]);
    const crypto = series.get("CRYPTO")!;
    expect(crypto.cumulative).toEqual([0, 0, 0]);
    expect(crypto.pnl).toBe(0);
    expect(crypto.pct).toBe(0);
  });

  it("rapporte le gain au capital engagé, apport de mi-période compris", () => {
    /*
      Classe ouverte à 0 : le gain ne peut pas se rapporter au premier jour,
      sans quoi le dénominateur serait nul. Le capital engagé retient le
      versement de 500 €, et les 50 € gagnés valent donc 10 %.
    */
    const series = buildClassPeriodSeries([
      point("2026-07-01", {}),
      point("2026-07-02", { OBLIGATIONS: 500 }, {}),
      point("2026-07-03", { OBLIGATIONS: 550 }, { OBLIGATIONS: 50 }),
    ]);
    const obligations = series.get("OBLIGATIONS")!;
    expect(obligations.pnl).toBe(50);
    expect(obligations.pct).toBeCloseTo(10, 6);
  });

  it("rend un pourcentage nul plutôt qu'un chiffre absurde sans capital", () => {
    // Position entièrement soldée avant la fenêtre : capital engagé nul.
    const series = buildClassPeriodSeries([
      point("2026-07-01", {}, { ACTIONS: 0 }),
      point("2026-07-02", {}, { ACTIONS: 10 }),
      point("2026-07-03", {}, { ACTIONS: 5 }),
    ]);
    const actions = series.get("ACTIONS")!;
    expect(actions.pnl).toBe(15);
    expect(actions.pct).toBeNull();
  });

  it("trace une ligne plate, et non l'absence de courbe, quand rien ne bouge", () => {
    /*
      Une classe qui ne bouge pas *est* une information : le palier se lit, et
      se distingue de la classe qu'on ne sait pas valoriser (signalée à part,
      via `incompleteClasses`).
    */
    const series = buildClassPeriodSeries([
      point("2026-07-01", { IMMOBILIER: 300000 }),
      point("2026-07-02", { IMMOBILIER: 300000 }, {}),
      point("2026-07-03", { IMMOBILIER: 300000 }, {}),
    ]);
    const immo = series.get("IMMOBILIER")!;
    expect(immo.cumulative).toEqual([0, 0, 0]);
    expect(immo.pct).toBe(0);
  });

  it("ignore une classe absente de toute la fenêtre", () => {
    const series = buildClassPeriodSeries([
      point("2026-07-01", { ACTIONS: 10 }),
      point("2026-07-02", { ACTIONS: 10 }, {}),
    ]);
    expect(series.has("CRYPTO")).toBe(false);
  });

  it("ne rend rien sous deux points : une courbe a besoin de deux dates", () => {
    expect(buildClassPeriodSeries([]).size).toBe(0);
    expect(
      buildClassPeriodSeries([point("2026-07-01", { ACTIONS: 10 })]).size
    ).toBe(0);
  });
});

/**
 * Validation des règles d’agrégation temporelle Évolution portefeuille.
 * 7J = 7 jours calendaires incluant aujourd’hui (journalier)
 * 1M / 3M = semaines ISO lundi→dimanche
 */
import { describe, expect, it } from "vitest";
import {
  buildEvolutionSeries,
  bucketKey,
  formatWeekRangeLabel,
  resolveEvolutionInterval,
  startOfIsoWeekMonday,
} from "@/app/lib/portfolio/evolution-aggregate";
import type { HistoryPoint } from "@/app/lib/types/ui";

function pt(date: string, total: number): HistoryPoint {
  return {
    date,
    label: date.slice(0, 10),
    totalValueEur: total,
    cashTotalEur: 0,
    totalValueBase: total,
    cashTotalBase: 0,
    positionsBase: total,
  };
}

/** Historique dense : 1 point / jour sur 120 jours jusqu’à `now`. */
function dailyHistory(now: Date, days: number): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(15, 0, 0, 0);
    out.push(pt(d.toISOString(), 100_000 + (days - i) * 10));
  }
  // Point live du jour (mise à jour continue)
  out.push(pt(now.toISOString(), 100_000 + days * 10 + 5));
  return out;
}

const NOW = new Date("2026-07-16T16:30:00.000Z"); // Thursday

describe("Règle 7J — 7 jours calendaires dont aujourd’hui", () => {
  it("intervalle journalier", () => {
    expect(resolveEvolutionInterval("7d", 10)).toBe("day");
  });

  it("produit des buckets jour distincts et inclut le jour courant", () => {
    const history = dailyHistory(NOW, 40);
    const { points, interval } = buildEvolutionSeries(
      history,
      "7d",
      "cumul",
      NOW
    );
    expect(interval).toBe("day");

    // 7 jours calendaires (J-6 … J) — tolérance ancre / live
    expect(points.length).toBeGreaterThanOrEqual(6);
    expect(points.length).toBeLessThanOrEqual(8);

    const dayKeys = points.map((p) => bucketKey(p.date, "day"));
    // Uniques
    expect(new Set(dayKeys).size).toBe(dayKeys.length);

    // Dernier point = jour actuel (live value)
    const lastDay = bucketKey(points[points.length - 1]!.date, "day");
    const todayKey = bucketKey(NOW.toISOString(), "day");
    expect(lastDay).toBe(todayKey);

    // Valeur live du jour (plus récente que le snapshot 15h)
    expect(points[points.length - 1]!.total).toBeCloseTo(100_000 + 40 * 10 + 5, 0);
  });

  it("fenêtre = J-6 00:00 → aujourd’hui (pas 7×24h glissants flous)", () => {
    const history = dailyHistory(NOW, 20);
    const { points } = buildEvolutionSeries(history, "7d", "cumul", NOW);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const firstDay = new Date(bucketKey(first.date, "day") + "T12:00:00.000Z");
    const lastDay = new Date(bucketKey(last.date, "day") + "T12:00:00.000Z");
    const spanDays =
      (lastDay.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000);
    // Exactement 6 jours entre premier et dernier des 7 jours
    expect(spanDays).toBeGreaterThanOrEqual(5);
    expect(spanDays).toBeLessThanOrEqual(6);
  });

  it("densifie les jours manquants (report de valeur)", () => {
    const sparse = [
      pt("2026-07-14T15:00:00.000Z", 100_000),
      pt("2026-07-16T16:30:00.000Z", 101_000),
    ];
    const { points } = buildEvolutionSeries(sparse, "7d", "cumul", NOW);
    const days = points.map((p) => bucketKey(p.date, "day"));
    expect(days).toContain("2026-07-14");
    expect(days).toContain("2026-07-15");
    expect(days).toContain("2026-07-16");
    const jul15 = points.find((p) => bucketKey(p.date, "day") === "2026-07-15");
    expect(jul15?.total).toBe(100_000);
  });
});

describe("Règle 1M / 3M — semaines ISO lundi→dimanche", () => {
  it("1M et 3M utilisent l’intervalle week", () => {
    expect(resolveEvolutionInterval("1m", 30)).toBe("week");
    expect(resolveEvolutionInterval("3m", 90)).toBe("week");
  });

  it("tous les jours d’une même semaine ISO partagent la clé lundi", () => {
    // Semaine du lun 13 → dim 19 juillet 2026 (heures encore dimanche en Europe/Paris)
    const mon = "2026-07-13T08:00:00.000Z";
    const wed = "2026-07-15T12:00:00.000Z";
    const sun = "2026-07-19T12:00:00.000Z"; // 14:00 Paris = dimanche
    const nextMon = "2026-07-20T08:00:00.000Z";
    expect(bucketKey(mon, "week")).toBe(bucketKey(wed, "week"));
    expect(bucketKey(wed, "week")).toBe(bucketKey(sun, "week"));
    expect(bucketKey(nextMon, "week")).not.toBe(bucketKey(wed, "week"));
    expect(bucketKey(wed, "week")).toMatch(/^W2026-07-13$/);
  });

  it("startOfIsoWeekMonday aligne sur le lundi", () => {
    // Thursday 16 Jul 2026 → Monday 13 Jul
    const mon = startOfIsoWeekMonday(NOW);
    expect(mon.toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("labels semaine = S. lundi - dimanche", () => {
    // 15 juil 2026 = mercredi → S. 13 juil. - 19 juil.
    const label = formatWeekRangeLabel("2026-07-15T12:00:00.000Z");
    expect(label).toMatch(/^S\.\s+/);
    expect(label).toMatch(/13/);
    expect(label).toMatch(/19/);
    expect(label).toMatch(/-/);
  });

  it("1M : un point par semaine ISO, stock = dernière obs de la semaine", () => {
    const history = dailyHistory(NOW, 45);
    const { points, interval } = buildEvolutionSeries(
      history,
      "1m",
      "cumul",
      NOW
    );
    expect(interval).toBe("week");
    // ~30–35 j → 5–6 semaines
    expect(points.length).toBeGreaterThanOrEqual(4);
    expect(points.length).toBeLessThanOrEqual(7);

    const weekKeys = points.map((p) => bucketKey(p.date, "week"));
    expect(new Set(weekKeys).size).toBe(weekKeys.length);

    // Labels axe : S. 13 juil. - 19 juil.
    for (const p of points) {
      expect(p.label).toMatch(/^S\.\s+/);
      expect(p.label).toMatch(/-/);
      expect(p.intervalType).toBe("week");
    }
  });

  it("3M : agrégation hebdomadaire sur fenêtre plus longue", () => {
    const history = dailyHistory(NOW, 100);
    const { points, interval } = buildEvolutionSeries(
      history,
      "3m",
      "cumul",
      NOW
    );
    expect(interval).toBe("week");
    // ~13 semaines
    expect(points.length).toBeGreaterThanOrEqual(10);
    expect(points.length).toBeLessThanOrEqual(16);

    // Semaines strictement croissantes
    for (let i = 1; i < points.length; i++) {
      expect(Date.parse(points[i]!.date)).toBeGreaterThan(
        Date.parse(points[i - 1]!.date)
      );
    }
  });

  it("valeur de semaine = dernière observation du dimanche (ou live en cours)", () => {
    // Deux obs même semaine : mercredi bas, vendredi haut → bucket = vendredi
    const history = [
      pt("2026-07-13T10:00:00.000Z", 100), // Mon
      pt("2026-07-15T10:00:00.000Z", 110), // Wed
      pt("2026-07-17T10:00:00.000Z", 125), // Fri — last of week
      pt("2026-07-20T10:00:00.000Z", 130), // next Mon
    ];
    const { points } = buildEvolutionSeries(
      history,
      "1m",
      "cumul",
      new Date("2026-07-21T12:00:00.000Z")
    );
    const weekOf13 = points.find(
      (p) => bucketKey(p.date, "week") === "W2026-07-13"
    );
    expect(weekOf13).toBeTruthy();
    expect(weekOf13!.total).toBe(125);
  });
});

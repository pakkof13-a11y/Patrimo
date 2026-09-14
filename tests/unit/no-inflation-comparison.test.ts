/**
 * Retrait du comparatif « évolution du portefeuille vs inflation française ».
 *
 * La fonctionnalité vivait dans un seul endroit : le sélecteur « Vs » du
 * graphique d'évolution du tableau de bord, à côté de « Aucun » et « Indice ».
 * Elle n'a jamais fonctionné — son alimentation exigeait un accès sortant vers
 * la banque de données macro de l'INSEE que l'environnement refuse — et la
 * décision produit a été de la retirer plutôt que d'y investir davantage.
 *
 * ## Ce que ces tests vérifient, et ce qu'ils ne vérifient pas
 *
 * Ils portent **uniquement** sur le comparatif du portefeuille. Ils ne
 * cherchent pas à faire disparaître le concept d'IPC du dépôt : le calendrier
 * économique annonce des publications d'IPC étrangers, et c'est une autre
 * fonctionnalité, intacte.
 *
 * Les contrôles structurels sont donc ciblés sur les symboles qui
 * n'existaient que pour ce comparatif, jamais sur des mots isolés comme
 * « IPC », « inflation » ou « INSEE » — ce dernier désignant aussi les codes
 * communes utilisés par le module Immobilier.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARK_OPTIONS } from "@/app/lib/portfolio/benchmark-prefs";
import { withBenchmarkSeries } from "@/app/lib/portfolio/evolution-aggregate";

const racine = join(__dirname, "..", "..");
const lire = (p: string) => readFileSync(join(racine, p), "utf8");

describe("le comparatif inflation n'est plus proposé", () => {
  it("« Inflation » ne figure plus parmi les comparatifs", () => {
    expect(DEFAULT_BENCHMARK_OPTIONS.map((c) => c.id)).not.toContain("inflation");
  });

  it("« Indice » reste proposé", () => {
    /*
      Le pendant positif, sans lequel ce fichier passerait sur un produit
      n'offrant plus aucune comparaison.
    */
    expect(DEFAULT_BENCHMARK_OPTIONS.map((c) => c.id)).toContain("index");
  });

  it("le sélecteur du graphique n'offre plus l'option", () => {
    const panneau = lire("components/dashboard/portfolio-evolution-panel.tsx");
    expect(panneau).not.toMatch(/id:\s*"inflation"/);
  });

  it("une préférence enregistrée avant le retrait ne trace aucune courbe", () => {
    /*
      Un utilisateur ayant choisi « Inflation » garde ce réglage en mémoire
      locale. Il doit se comporter comme un comparatif sans données : pas de
      courbe. Une ligne à zéro affirmerait une inflation nulle — une mesure,
      et non une absence de mesure.
    */
    const base = [
      { date: "2026-01-01T00:00:00.000Z", total: 100_000 },
      { date: "2026-07-01T00:00:00.000Z", total: 110_000 },
    ] as Parameters<typeof withBenchmarkSeries>[0];

    const out = withBenchmarkSeries(base, "inflation" as never);
    expect(out[0]!.benchmark).toBeUndefined();
    expect(out[1]!.benchmark).toBeUndefined();
  });

  it("le comparatif avec indice trace toujours sa courbe", () => {
    const base = [
      { date: "2026-01-01T00:00:00.000Z", total: 100_000 },
      { date: "2026-07-01T00:00:00.000Z", total: 110_000 },
    ] as Parameters<typeof withBenchmarkSeries>[0];

    const out = withBenchmarkSeries(base, "index", {
      indexCloses: [
        { date: "2026-01-01T00:00:00.000Z", close: 100 },
        { date: "2026-07-01T00:00:00.000Z", close: 104 },
      ],
    });

    // Rebasé sur le premier total, puis +4 % — la valeur de l'indice, exacte.
    expect(out[0]!.benchmark).toBeCloseTo(100_000, 6);
    expect(out[1]!.benchmark).toBeCloseTo(104_000, 6);
  });

  it("activer le comparatif ne change aucune valeur du portefeuille", () => {
    const base = [
      { date: "2026-01-01T00:00:00.000Z", total: 100_000 },
      { date: "2026-07-01T00:00:00.000Z", total: 110_000 },
    ] as Parameters<typeof withBenchmarkSeries>[0];

    const sans = withBenchmarkSeries(base, "none");
    const avec = withBenchmarkSeries(base, "index", {
      indexCloses: [
        { date: "2026-01-01T00:00:00.000Z", close: 100 },
        { date: "2026-07-01T00:00:00.000Z", close: 104 },
      ],
    });

    for (let i = 0; i < base.length; i++) {
      expect(avec[i]!.total).toBe(sans[i]!.total);
      expect(avec[i]!.chartValue).toBe(sans[i]!.chartValue);
    }
  });
});

describe("le code propre au comparatif a disparu, et lui seul", () => {
  it("les modules d'alimentation IPC n'existent plus", () => {
    /*
      Ces quatre modules n'avaient qu'un consommateur : ce comparatif. Vérifié
      avant suppression — aucun écran macro ne les importait, le calendrier
      économique tirant ses données de `news/macro-live`.
    */
    for (const chemin of [
      "app/lib/macro/cpi.ts",
      "app/lib/macro/cpi-collector.ts",
      "app/lib/macro/cpi-repository.ts",
      "app/lib/macro/providers/insee-cpi.ts",
      "app/api/macro/cpi/route.ts",
    ]) {
      expect(existsSync(join(racine, chemin))).toBe(false);
    }
  });

  it("le calendrier économique, lui, est intact", () => {
    // `/api/macro` sert le calendrier — une autre fonctionnalité, conservée.
    expect(existsSync(join(racine, "app/api/macro/route.ts"))).toBe(true);
    expect(existsSync(join(racine, "app/lib/news/macro-live.ts"))).toBe(true);
  });

  it("la table d'observations, écrite par le seul collecteur, a disparu", () => {
    expect(lire("prisma/schema.prisma")).not.toMatch(/model CpiObservation/);
  });

  it("la tâche planifiée ne collecte plus d'IPC mais collecte toujours les cours", () => {
    const cron = lire("app/api/cron/collect-intraday/route.ts");
    expect(cron).not.toMatch(/[Cc]pi/);
    expect(cron).toMatch(/collectIntradayBars\s*\(/);
    expect(cron).toMatch(/backfillDailyClosesFromFirstTx\s*\(/);
  });

  it("l'agrégation ne connaît plus le mode inflation", () => {
    const agg = lire("app/lib/portfolio/evolution-aggregate.ts");
    expect(agg).not.toMatch(/cpiCumulative|makeCpiPicker|isInflationComparisonAvailable/);
    // Mais elle connaît toujours l'indice.
    expect(agg).toMatch(/makeIndexPicker/);
  });
});

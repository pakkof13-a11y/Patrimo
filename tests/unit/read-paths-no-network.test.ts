/**
 * Garde-fou : une lecture ne collecte rien.
 *
 * Consulter un écran ne doit ni contacter un fournisseur, ni écrire en base.
 * Sans cela, l'historique d'un compte dépend de la fréquence de ses visites et
 * de la disponibilité de Yahoo au moment du regard — deux variables qui n'ont
 * rien à faire dans un patrimoine.
 *
 * Le contrôle est **structurel** : il lit le code source plutôt que d'exécuter
 * les services, parce que c'est l'appel lui-même qu'on veut interdire. Un test
 * qui se contenterait d'espionner `fetch` passerait dès qu'un cache serait
 * chaud, c'est-à-dire presque toujours, et laisserait le défaut revenir.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const racine = join(__dirname, "..", "..");
const lire = (p: string) => readFileSync(join(racine, p), "utf8");

/**
 * Chemins de lecture nourrissant une courbe ou une vignette KPI.
 *
 * Chacun a appelé les fournisseurs à un moment de l'histoire de ce dépôt.
 */
const CHEMINS_DE_LECTURE = [
  "app/api/portfolio/sparklines/route.ts",
  "app/lib/portfolio/class-pnl-service.ts",
  "app/lib/life-insurance/performance-service.ts",
  "app/lib/crypto/spot-history-service.ts",
] as const;

describe("chemins de lecture — aucune collecte, aucun fournisseur", () => {
  it.each(CHEMINS_DE_LECTURE)("%s ne déclenche aucune collecte", (chemin) => {
    const src = lire(chemin);

    // Les collecteurs appartiennent à la tâche planifiée, à elle seule.
    expect(src).not.toMatch(/collectDailyCloses(ForAssets)?\s*\(/);
    expect(src).not.toMatch(/collectIntradayBars\s*\(/);
    expect(src).not.toMatch(/fillDailyCloses\s*\(/);
  });

  it.each(CHEMINS_DE_LECTURE)(
    "%s ne lit le cache qu'en lecture seule",
    (chemin) => {
      const src = lire(chemin);
      /*
        `getDailyCloses` collecte par défaut : sans `refresh: false`, une simple
        consultation rappelle les fournisseurs et écrit `AssetDailyClose`.
        C'est précisément le défaut corrigé — il ne doit pas revenir par
        omission d'une option.
      */
      const appels = src.match(/getDailyCloses\s*\(/g) ?? [];
      if (appels.length === 0) return;

      expect(appels).toHaveLength(1);
      expect(src).toMatch(/refresh:\s*false/);
    }
  );

  it("seule la tâche planifiée appelle les collecteurs", () => {
    const cron = lire("app/api/cron/collect-intraday/route.ts");

    // Le pendant positif : si cette route cessait de collecter, les tests
    // ci-dessus passeraient sur une application qui n'accumule plus rien.
    expect(cron).toMatch(/collectIntradayBars\s*\(/);
    expect(cron).toMatch(/collectDailyClosesForAssets\s*\(/);
  });
});

describe("PortfolioSnapshot n'est jamais une source de courbe", () => {
  it("aucun chemin de lecture KPI ne lit la table de relevés", () => {
    /*
      `PortfolioSnapshot` est un journal d'audit : il enregistre ce qu'un écran
      affichait à un instant, avec le périmètre de cet instant. Le reconstituer
      en courbe mélangerait des périmètres différents — c'est l'incohérence que
      `PortfolioValuationEngine` a remplacée, et la table est restée pour la
      traçabilité, pas pour l'affichage.
    */
    for (const chemin of [
      ...CHEMINS_DE_LECTURE,
      "app/lib/portfolio/historical/engine.ts",
      "app/lib/portfolio/evolution-aggregate.ts",
    ]) {
      expect(lire(chemin)).not.toMatch(/prisma\.portfolioSnapshot\.(find|groupBy|aggregate)/);
    }
  });
});

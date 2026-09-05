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

import { readdirSync, readFileSync } from "node:fs";
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
  "app/api/portfolio/daily-nav/route.ts",
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
    expect(src).not.toMatch(/backfillDailyClosesFromFirstTx\s*\(/);
  });

  it.each(CHEMINS_DE_LECTURE)(
    "%s ne lit le cache qu'en lecture seule",
    (chemin) => {
      const src = lire(chemin);
      /*
        `getDailyCloses` ne collecte plus que sur `refresh: true`. L'omission
        est donc devenue sûre, et exiger `refresh: false` n'aurait plus de sens
        — ce serait contraindre une écriture facultative.

        Ce qui reste dangereux, et que ce test garde désormais, c'est la
        demande explicite : un chemin de lecture qui réclamerait la collecte
        rappellerait les fournisseurs et écrirait `AssetDailyClose` au milieu
        d'une simple consultation.
      */
      const appels = src.match(/getDailyCloses\s*\(/g) ?? [];
      if (appels.length === 0) return;

      expect(appels).toHaveLength(1);
      expect(src).not.toMatch(/refresh:\s*true/);
    }
  );

  it("seule la tâche planifiée appelle les collecteurs", () => {
    const cron = lire("app/api/cron/collect-intraday/route.ts");

    // Le pendant positif : si cette route cessait de collecter, les tests
    // ci-dessus passeraient sur une application qui n'accumule plus rien.
    expect(cron).toMatch(/collectIntradayBars\s*\(/);
    expect(cron).toMatch(/backfillDailyClosesFromFirstTx\s*\(/);
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

describe("aucune quatrième porte", () => {
  /**
   * Le contrôle par liste ne protège que les chemins qu'on a pensé à y mettre.
   * Celui-ci raisonne à l'envers : il balaie **toutes** les routes d'API et
   * n'autorise la collecte que là où elle a sa place.
   */
  function toutesLesRoutes(): string[] {
    const out: string[] = [];
    const parcourir = (rel: string) => {
      for (const e of readdirSync(join(racine, rel), { withFileTypes: true })) {
        const enfant = `${rel}/${e.name}`;
        if (e.isDirectory()) parcourir(enfant);
        else if (e.name === "route.ts") out.push(enfant);
      }
    };
    parcourir("app/api");
    return out;
  }

  /** Le seul chemin autorisé à collecter : la tâche planifiée. */
  const COLLECTE_AUTORISEE = ["app/api/cron/collect-intraday/route.ts"];

  it("seule la tâche planifiée appelle un collecteur", () => {
    const routes = toutesLesRoutes();
    // Le balayage doit avoir trouvé quelque chose, sinon le test est vide.
    expect(routes.length).toBeGreaterThan(20);

    const fautives = routes.filter(
      (r) =>
        !COLLECTE_AUTORISEE.includes(r) &&
        /collectDailyCloses(ForAssets)?\s*\(|collectIntradayBars\s*\(|fillDailyCloses\s*\(|backfillDailyClosesFromFirstTx\s*\(/.test(
          lire(r)
        )
    );

    expect(fautives).toEqual([]);
  });

  it("aucune route ne demande la collecte de clôtures", () => {
    /*
      L'omission ne collecte plus : ce test gardait la porte contre un oubli, il
      garde désormais contre une demande. Une route qui passerait
      `refresh: true` collecterait sans qu'aucun nom de collecteur n'apparaisse
      dans son code — c'est le seul chemin par lequel la collecte peut encore
      s'inviter dans une consultation.
    */
    const fautives = toutesLesRoutes().filter((r) => {
      const src = lire(r);
      return /getDailyCloses\s*\(/.test(src) && /refresh:\s*true/.test(src);
    });

    expect(fautives).toEqual([]);
  });
});

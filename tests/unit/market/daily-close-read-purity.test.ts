import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Une lecture d'historique ne collecte pas.
 *
 * `getDailyCloses` complète le cache avant de répondre : c'est légitime pour un
 * écran qui vient de demander une plage, mais interdit pour le moteur
 * historique, qui doit pouvoir reconstruire cinq ans sans qu'un affichage
 * déclenche des appels fournisseurs.
 *
 * Depuis que la tâche planifiée entretient `AssetDailyClose`, cette séparation
 * compte davantage : la collecte a un endroit, et ce n'est pas le chemin de
 * lecture. Ce test lit les fichiers réels plutôt que le comportement — le
 * défaut à prévenir est un appel réintroduit, qu'un test de comportement ne
 * verrait que si la fixture contenait justement un cache périmé.
 */

/** Fonctions qui peuvent appeler un fournisseur. */
const COLLECTE = ["getDailyCloses", "collectDailyCloses", "fillDailyCloses"];

/** Chemins qui reconstruisent le patrimoine et ne doivent que lire. */
const LECTEURS = [
  "app/lib/portfolio/historical/load.ts",
  "app/lib/portfolio/historical/engine.ts",
  "app/lib/portfolio/intraday/series.ts",
  "app/lib/portfolio/intraday/bar-index.ts",
  "app/lib/market/market-data-repository.ts",
];

const lire = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Retire commentaires : seul le code exécuté compte. */
const codeSeul = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("le moteur historique lit sans collecter", () => {
  for (const chemin of LECTEURS) {
    it(`${chemin} n'appelle aucune fonction de collecte`, () => {
      const code = codeSeul(lire(chemin));
      for (const fn of COLLECTE) {
        expect(code, `${chemin} appelle ${fn}`).not.toContain(fn);
      }
    });
  }

  it("le chargement historique passe par la lecture pure du cache", () => {
    const code = codeSeul(lire("app/lib/portfolio/historical/load.ts"));
    expect(code).toContain("readDailyCloses");
  });
});

describe("la collecte a un seul endroit", () => {
  it("le cron appelle la collecte quotidienne", () => {
    const code = codeSeul(lire("app/api/cron/collect-intraday/route.ts"));
    expect(code).toContain("collectDailyClosesForAssets");
    expect(code).toContain("collectIntradayBars");
  });

  it("8 — l'écran et le cron partagent la même implémentation", () => {
    /*
      `getDailyCloses` déléguait sa boucle de remplissage ; elle est désormais
      extraite dans `collectDailyCloses`, que les deux appelants utilisent.
      Deux boucles auraient fini par porter deux politiques de fraîcheur.
    */
    const code = codeSeul(lire("app/lib/market/daily-closes.ts"));
    const debut = code.indexOf("export async function getDailyCloses");
    expect(debut).toBeGreaterThan(-1);
    const corps = code.slice(debut);
    expect(corps).toContain("collectDailyCloses(");

    const collecteur = codeSeul(lire("app/lib/market/intraday-collector.ts"));
    expect(collecteur).toContain("collectDailyCloses(");
  });

  it("le périmètre d'actifs est celui de l'intraday", () => {
    const code = codeSeul(lire("app/lib/market/intraday-collector.ts"));
    const debut = code.indexOf("export async function collectDailyClosesForAssets");
    const corps = code.slice(debut);
    expect(corps).toContain("listCollectableAssets");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou d'architecture : un lecteur de dette n'écrit pas.
 *
 * `listLiabilities` amortissait en base avant de répondre. Ouvrir le module
 * Crédits écrivait 79 `LiabilityEvent` sur le compte de démonstration, et le
 * patrimoine net changeait de 64 020 € selon qu'on avait consulté cet écran ou
 * non. La correction a rendu les six lecteurs purs ; ce test empêche qu'on les
 * rende à nouveau écrivants sans s'en apercevoir.
 *
 * Il lit les fichiers réels plutôt que d'appeler les fonctions : le défaut à
 * prévenir est textuel — un `await applyDuePayments…` réintroduit dans un
 * chemin de lecture — et un test de comportement ne le verrait que si la
 * fixture contenait justement une échéance échue. `e2e/passifs-lecture-pure`
 * couvre le comportement ; celui-ci couvre la structure.
 */

/** Les fonctions qui écrivent des échéances en base. */
const MATERIALISATION = [
  "applyDuePaymentsForLiability",
  "applyDuePaymentsForUser",
];

/** Tout chemin qui lit une dette sans avoir le droit de la modifier. */
const LECTEURS = [
  "app/api/real-estate/properties/route.ts",
  "app/api/platforms/route.ts",
  "app/lib/portfolio/service.ts",
  "app/lib/portfolio/historical/load.ts",
  "app/lib/real-estate/tax/service.ts",
];

const lire = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Retire commentaires de bloc et de ligne : seul le code exécuté compte. */
function codeSeul(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("les lecteurs de dettes ne matérialisent pas", () => {
  for (const chemin of LECTEURS) {
    it(`${chemin} n'appelle aucune fonction d'écriture d'échéance`, () => {
      const code = codeSeul(lire(chemin));
      for (const fn of MATERIALISATION) {
        expect(code, `${chemin} appelle ${fn}`).not.toContain(fn);
      }
    });
  }

  it("listLiabilities projette au lieu d'écrire", () => {
    /*
      Le service contient les fonctions de matérialisation : on ne peut pas se
      contenter d'y chercher leur nom. On isole donc le corps de la fonction de
      lecture, et c'est lui qui doit être pur.
    */
    const source = codeSeul(lire("app/lib/liabilities/service.ts"));
    const debut = source.indexOf("export async function listLiabilities");
    expect(debut, "listLiabilities introuvable").toBeGreaterThan(-1);
    const suite = source.slice(debut + 1);
    const fin = suite.indexOf("\nexport ");
    const corps = fin > -1 ? suite.slice(0, fin) : suite;

    for (const fn of MATERIALISATION) {
      expect(corps, `listLiabilities appelle ${fn}`).not.toContain(fn);
    }
    expect(corps).toContain("remainingAmountAt");
  });
});

describe("la matérialisation reste possible là où elle a un sens", () => {
  it("le remboursement anticipé matérialise avant d'imputer", () => {
    /*
      Le pendant du test précédent. Rendre les lecteurs purs ne doit pas avoir
      supprimé la matérialisation : `recordEarlyRepayment` impute sur un capital
      restant dû, qui doit exister en base avant d'être touché.
    */
    const source = codeSeul(lire("app/lib/liabilities/service.ts"));
    const debut = source.indexOf("export async function recordEarlyRepayment");
    const suite = source.slice(debut + 1);
    const fin = suite.indexOf("\nexport ");
    const corps = fin > -1 ? suite.slice(0, fin) : suite;

    expect(corps).toContain("applyDuePaymentsForLiability");
  });

  it("aucun GET du module Crédits ne déclenche de matérialisation", () => {
    const code = codeSeul(lire("app/api/liabilities/route.ts"));
    const debut = code.indexOf("export async function GET");
    expect(debut, "GET introuvable").toBeGreaterThan(-1);
    const suite = code.slice(debut + 1);
    const fin = suite.indexOf("\nexport ");
    const corps = fin > -1 ? suite.slice(0, fin) : suite;

    for (const fn of MATERIALISATION) {
      expect(corps, `le GET appelle ${fn}`).not.toContain(fn);
    }
  });
});

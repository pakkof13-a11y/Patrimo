import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou d'architecture : un lecteur de livret n'écrit pas.
 *
 * `listSavingsAccounts` créditait les intérêts dus avant de répondre — « daily
 * automation trigger ». Un GET de l'onglet Banques matérialisait donc des
 * périodes d'intérêts, avançait `lastPayoutAt` et inscrivait un événement
 * `INTEREST` par livret : le patrimoine net dépendait de l'ordre de
 * navigation, exactement comme pour les crédits avant la correction que garde
 * `liabilities-lecture-pure.test.ts`.
 *
 * Le solde affiché n'a pas changé : `mapSavingsRowForApi` projette déjà les
 * intérêts courus (`savingsDisplayBalance`). Seule l'écriture a disparu.
 *
 * Ce test lit les fichiers réels, comme son jumeau des dettes : le défaut à
 * prévenir est textuel — un `await applyDueInterest…` remis dans un chemin de
 * lecture — et un test de comportement ne le verrait que si la fixture portait
 * justement une période échue.
 */

/** Les fonctions qui écrivent des intérêts en base. */
const MATERIALISATION = ["applyDueInterestForUser", "applyDueInterestForSavings"];

/** Tout chemin qui lit un livret sans avoir le droit de le modifier. */
const LECTEURS = [
  "app/lib/cash/pockets.ts",
  "app/lib/cash/term-deposits-list.ts",
  "app/lib/portfolio/service.ts",
  "app/lib/portfolio/allocation-by-venue.ts",
  "app/lib/portfolio/historical/load.ts",
  "app/api/banks/summary/route.ts",
];

const lire = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Retire commentaires de bloc et de ligne : seul le code exécuté compte. */
function codeSeul(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Corps d'une fonction exportée, jusqu'au prochain `export`. */
function corpsDe(source: string, signature: string): string {
  const debut = source.indexOf(signature);
  expect(debut, `${signature} introuvable`).toBeGreaterThan(-1);
  const suite = source.slice(debut + 1);
  const fin = suite.indexOf("\nexport ");
  return fin > -1 ? suite.slice(0, fin) : suite;
}

describe("les lecteurs de livrets ne matérialisent pas", () => {
  for (const chemin of LECTEURS) {
    it(`${chemin} n'appelle aucune fonction de crédit d'intérêts`, () => {
      const code = codeSeul(lire(chemin));
      for (const fn of MATERIALISATION) {
        expect(code, `${chemin} appelle ${fn}`).not.toContain(fn);
      }
    });
  }

  it("listSavingsAccounts projette au lieu d'écrire", () => {
    const corps = corpsDe(
      codeSeul(lire("app/lib/cash/pockets.ts")),
      "export async function listSavingsAccounts"
    );
    for (const fn of MATERIALISATION) {
      expect(corps, `listSavingsAccounts appelle ${fn}`).not.toContain(fn);
    }
    // La projection, elle, doit rester : c'est ce qui rend l'écriture inutile.
    expect(corps).toContain("mapSavingsRowForApi");
  });

  it("aucun GET du module Livrets ne déclenche de matérialisation", () => {
    const corps = corpsDe(
      codeSeul(lire("app/api/savings/route.ts")),
      "export async function GET"
    );
    for (const fn of MATERIALISATION) {
      expect(corps, `le GET appelle ${fn}`).not.toContain(fn);
    }
  });
});

describe("la matérialisation reste possible là où elle a un sens", () => {
  it("le PUT d'un livret crédite avant de journaliser l'écart", () => {
    /*
      Le pendant du test précédent : rendre les lectures pures ne doit pas
      avoir supprimé la matérialisation. Le PUT part du solde réel, intérêts
      crédités, sinon il journaliserait un apport à la place d'un intérêt.
    */
    const corps = corpsDe(
      codeSeul(lire("app/api/savings/route.ts")),
      "export async function PUT"
    );
    expect(corps).toContain("applyDueInterestForUser");
  });

  it("le cron d'accrual reste le déclencheur automatique", () => {
    const code = codeSeul(lire("app/api/savings/accrue/route.ts"));
    expect(code).toContain("applyDueInterestForUser");
  });
});

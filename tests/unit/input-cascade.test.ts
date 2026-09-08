import { describe, expect, it, type TestContext } from "vitest";
import {
  diff,
  explainChromiumSearch,
  extractCombinations,
  findChromium,
  formatDiff,
  measure,
  readBaseline,
} from "../../tools/input-cascade/harness.mjs";

/**
 * Garde-fou de la cascade `.input`.
 *
 * `app/globals.css` est hors couche : ses classes battent les utilitaires
 * Tailwind, qui sont en couche. Rendre `.input` à `@layer components` — le
 * correctif de fond — redonne la main aux utilitaires, et change donc le rendu
 * de champs que personne n'a demandé à changer. Ce test dit lesquels.
 *
 * Il ne dit pas si le changement est souhaitable : c'est un relevé, pas un
 * jugement. Une différence attendue se referme en relisant les écarts puis en
 * réenregistrant la référence (`npm run input:baseline`) — jamais l'inverse.
 *
 * Il n'ouvre ni base de données ni session : le CSS du dépôt est compilé par la
 * chaîne PostCSS du projet et appliqué à une page statique. Voir
 * `tools/input-cascade/harness.mts`.
 *
 * ## Pourquoi le saut s'annonce
 *
 * Les deux mesures ci-dessous demandent un navigateur, et sautent quand il
 * manque. Elles sautaient **en silence** : sur une machine où la version
 * installée ne correspondait pas à celle épinglée, la suite affichait « 2
 * ignorés » et personne ne pouvait distinguer cela d'un feu vert. Trois
 * semaines ont passé ainsi, et le premier poste à disposer du bon build a
 * trouvé les deux tests en échec.
 *
 * Un test qui ne peut pas s'exécuter doit donc dire ce qu'il a cherché et où :
 * `ctx.skip(raison)` porte le message jusqu'au rapport. Et
 * `INPUT_CASCADE_REQUIRE_BROWSER=1` transforme le saut en échec, pour une
 * chaîne d'intégration qui veut exiger la mesure plutôt que l'espérer.
 */

const chromium = findChromium();

/** Exiger la mesure au lieu de la souhaiter. Absent par défaut : rien ne change. */
const REQUIRE_BROWSER = process.env.INPUT_CASCADE_REQUIRE_BROWSER === "1";

/**
 * Le chemin du navigateur, ou un saut qui explique son absence.
 *
 * Rend `null` quand il faut renoncer — l'appelant sort alors immédiatement.
 * `ctx.skip()` jette déjà, mais le `return` explicite épargne au lecteur
 * comme au compilateur d'avoir à le savoir.
 */
function chromiumOuSaut(ctx: TestContext): string | null {
  if (chromium.path) return chromium.path;
  const raison = explainChromiumSearch(chromium.search);
  if (REQUIRE_BROWSER) throw new Error(raison);
  ctx.skip(raison);
  return null;
}

describe("cascade .input", () => {
  it("les combinaisons du dépôt sont toutes couvertes par la référence", () => {
    const combinations = extractCombinations();
    const baseline = readBaseline();
    const known = new Set(baseline.combinations.map((c) => c.classes));

    // Une combinaison écrite depuis le dernier enregistrement échapperait à la
    // mesure sans que rien ne le dise. Ce test-là ne demande pas de navigateur.
    const missing = combinations.filter((c) => !known.has(c.classes));
    expect(
      missing.map((c) => c.classes),
      "combinaisons absentes de la référence — lancer `npm run input:baseline`"
    ).toEqual([]);
  });

  it(
    "le rendu calculé est identique à la référence",
    async (ctx) => {
      if (!chromiumOuSaut(ctx)) return;
      const differences = diff(readBaseline(), await measure());
      expect(differences, formatDiff(differences)).toEqual([]);
    },
    60_000
  );

  it(
    "la peau du champ tient dans ses quatre états",
    async (ctx) => {
      /*
        Redite volontaire du test précédent, sur le seul sous-ensemble qui ne
        doit jamais bouger : bordure, rayon, fond, couleur, contour, ombre,
        opacité, curseur — au repos, au survol, à la saisie, désactivé. Un échec
        ici se lit sans dépouiller soixante combinaisons.
      */
      if (!chromiumOuSaut(ctx)) return;
      const differences = diff(readBaseline(), await measure()).filter((d) =>
        d.scope.startsWith("peau")
      );
      expect(differences, formatDiff(differences)).toEqual([]);
    },
    60_000
  );
});

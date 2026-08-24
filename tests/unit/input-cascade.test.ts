import { describe, expect, it } from "vitest";
import {
  diff,
  extractCombinations,
  formatDiff,
  measure,
  readBaseline,
  resolveChromium,
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
 */

const chromiumPath = resolveChromium();

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

  it.skipIf(!chromiumPath)(
    "le rendu calculé est identique à la référence",
    async () => {
      const differences = diff(readBaseline(), await measure());
      expect(differences, formatDiff(differences)).toEqual([]);
    },
    60_000
  );

  it.skipIf(!chromiumPath)(
    "la peau du champ tient dans ses quatre états",
    async () => {
      /*
        Redite volontaire du test précédent, sur le seul sous-ensemble qui ne
        doit jamais bouger : bordure, rayon, fond, couleur, contour, ombre,
        opacité, curseur — au repos, au survol, à la saisie, désactivé. Un échec
        ici se lit sans dépouiller soixante combinaisons.
      */
      const differences = diff(readBaseline(), await measure()).filter((d) =>
        d.scope.startsWith("peau")
      );
      expect(differences, formatDiff(differences)).toEqual([]);
    },
    60_000
  );
});

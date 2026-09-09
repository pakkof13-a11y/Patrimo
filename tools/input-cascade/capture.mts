/**
 * Enregistre la référence du harnais `.input` : `npm run input:baseline`.
 *
 * À n'exécuter que délibérément. Réenregistrer la référence fait disparaître
 * la différence au lieu de la montrer — c'est le geste à faire *après* avoir
 * relu chaque écart, jamais pour faire passer un test au vert.
 */

import { writeFileSync } from "node:fs";
import { BASELINE_PATH, diff, formatDiff, measure, readBaseline } from "./harness.mjs";

const snapshot = await measure();

let previous: ReturnType<typeof readBaseline> | null = null;
try {
  previous = readBaseline();
} catch {
  previous = null;
}

if (previous) {
  console.log(formatDiff(diff(previous, snapshot)));
}

/*
  Fusion, jamais écrasement.

  Une mesure ne connaît que la plateforme qui l'exécute : enregistrer depuis
  Windows avec un simple `writeFileSync` effacerait les largeurs Linux, que
  personne ne peut réenregistrer d'ici. Le commun — typographie, remplissages,
  peau, police — vient de la mesure fraîche ; les largeurs et les conditions
  de prise des autres plateformes sont conservées telles quelles.
*/
const merged: typeof snapshot = {
  ...snapshot,
  widths: { ...(previous?.widths ?? {}), ...(snapshot.widths ?? {}) },
  environments: {
    ...(previous?.environments ?? {}),
    ...(snapshot.environments ?? {}),
  },
};

writeFileSync(BASELINE_PATH, `${JSON.stringify(merged, null, 2)}\n`);

const ecrite = Object.keys(snapshot.widths ?? {})[0];
const gardees = Object.keys(merged.widths ?? {}).filter((k) => k !== ecrite);
console.log(
  `\nRéférence enregistrée : ${merged.combinations.length} combinaisons, ` +
    `${merged.combinations.reduce((n, c) => n + c.count, 0)} occurrences.`
);
console.log(`Largeurs réécrites pour la plateforme : ${ecrite}`);
console.log(
  gardees.length
    ? `Largeurs conservées, non mesurées ici : ${gardees.join(", ")}`
    : "Aucune autre plateforme enregistrée."
);

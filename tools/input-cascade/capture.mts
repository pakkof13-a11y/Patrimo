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

writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `\nRéférence enregistrée : ${snapshot.combinations.length} combinaisons, ` +
    `${snapshot.combinations.reduce((n, c) => n + c.count, 0)} occurrences.`
);

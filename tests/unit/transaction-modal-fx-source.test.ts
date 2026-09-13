import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * JOU-02 — preuve sur le source (pas de RTL/jsdom dans ce repo : voir
 * `tests/unit/design-tokens-contrast.test.ts` pour le même pattern de lecture
 * directe du fichier réel).
 *
 * Root cause : le taux historique (Frankfurter/BCE à la date de l'opération)
 * n'était rechargé que pour les revenus (`isIncome`). Pour ACHAT/VENTE/
 * APPORT/RETRAIT/FRAIS/REWARD/AIRDROP, un changement de devise posait le taux
 * DU JOUR dans `fxRateToEur`, une vraie valeur numérique jamais recalculée
 * par `resolveFx` côté serveur.
 *
 * Ce test verrouille les deux moitiés du correctif :
 *   1. L'effet « taux historique » n'est plus gardé par `isIncome`.
 *   2. L'effet « changement de devise » ne pose plus jamais de valeur
 *      numérique du jour dans `fxRateToEur` — seulement "1" ou "".
 */

const SOURCE = readFileSync(
  resolve(process.cwd(), "components/modals/transaction-modal.tsx"),
  "utf8"
);

/** Extrait le texte complet d'un appel `useEffect(...)` à partir d'un repère unique de son corps. */
function extractUseEffect(anchor: string): string {
  const anchorIdx = SOURCE.indexOf(anchor);
  if (anchorIdx < 0) throw new Error(`Repère introuvable : ${anchor}`);
  const start = SOURCE.lastIndexOf("useEffect(", anchorIdx);
  if (start < 0) throw new Error(`useEffect introuvable avant : ${anchor}`);
  let depth = 0;
  let i = start + "useEffect".length; // pointe sur le '(' d'ouverture
  for (; i < SOURCE.length; i++) {
    if (SOURCE[i] === "(") depth++;
    else if (SOURCE[i] === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return SOURCE.slice(start, i);
}

describe("transaction-modal — source JOU-02", () => {
  const historicalEffect = extractUseEffect(
    'const cur = (currency || "EUR").toUpperCase();'
  );
  const currencyChangeEffect = extractUseEffect(
    'const next = (currency || "EUR").toUpperCase();'
  );

  it("l'effet de taux historique n'est plus gardé par isIncome", () => {
    expect(historicalEffect).not.toMatch(/if\s*\(\s*!open\s*\|\|\s*!isIncome\s*\)/);
    expect(historicalEffect).toMatch(/if\s*\(\s*!open\s*\)\s*return;/);
    // Aucune branche de la logique elle-même ne doit plus tester isIncome —
    // seul le tableau de dépendances (hors du corps qu'on isole ici) peut
    // encore le référencer pour redéclencher l'effet. On retire les
    // commentaires (bloc et ligne) avant de chercher, car le JSDoc du
    // correctif nomme lui-même `isIncome` en toutes lettres.
    const body = historicalEffect
      .slice(0, historicalEffect.lastIndexOf("}, ["))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(body).not.toMatch(/isIncome/);
  });

  it("le jour retenu (paymentDate || occurredAt) est identique pour un revenu et pour un ACHAT", () => {
    // La logique n'est plus branchée sur isIncome : elle est donc
    // structurellement la même quel que soit le type d'opération.
    expect(historicalEffect).toMatch(
      /const day = String\(paymentDate \|\| occurredAt \|\| ""\)\.slice\(0, 10\);/
    );
  });

  it("l'effet de changement de devise ne pose jamais de valeur numérique du jour dans fxRateToEur", () => {
    const setValueCalls = [
      ...currencyChangeEffect.matchAll(/form\.setValue\(\s*"fxRateToEur",\s*([^,]+),/g),
    ].map((m) => m[1]!.trim());

    expect(setValueCalls.length).toBeGreaterThan(0);
    for (const value of setValueCalls) {
      expect(value).not.toMatch(/newFx/);
      expect(value === '"1"' || value === 'next === "EUR" ? "1" : ""').toBe(
        true
      );
    }
  });

  it("newFx (taux du jour) ne sert plus qu'à la conversion des montants, jamais à fxRateToEur", () => {
    const newFxUses = [...currencyChangeEffect.matchAll(/newFx/g)];
    // Une seule occurrence : la déclaration `const newFx = ...`. S'il
    // réapparaît ailleurs dans ce bloc, c'est qu'il a fui vers un autre champ
    // (typiquement le hint, ce qui est acceptable, ou pire, fxRateToEur).
    for (const use of newFxUses) {
      const around = currencyChangeEffect.slice(
        Math.max(0, use.index! - 40),
        use.index! + 40
      );
      expect(around).not.toMatch(/setValue\(\s*"fxRateToEur"/);
    }
  });
});

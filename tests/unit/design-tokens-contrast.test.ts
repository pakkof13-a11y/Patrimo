import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou du design system.
 *
 * Les couleurs du terminal vivent dans `app/globals.css`, pas dans le TS :
 * un test qui redéclarerait la palette ne prouverait rien. On lit donc le
 * fichier réel, on résout les `var()`, et on vérifie chaque paire
 * texte/surface effectivement employée par l'interface.
 *
 * Seuils WCAG 2.1 : 4,5:1 pour du texte courant, 3:1 pour un trait de
 * graphique ou un élément d'interface non textuel.
 */

const CSS = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

/** Extrait les déclarations `--token: valeur;` d'un bloc de règle donné. */
function tokensOfBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Bloc introuvable : ${selector}`);
  let depth = 0;
  let end = start;
  for (let i = CSS.indexOf("{", start); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = CSS.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

const LIGHT = tokensOfBlock(":root");
const DARK = { ...LIGHT, ...tokensOfBlock(".dark") };

/** Résout récursivement `var(--x)` jusqu'à une valeur littérale. */
function resolveToken(scope: Record<string, string>, name: string): string {
  let value = scope[name];
  if (!value) throw new Error(`Token absent : ${name}`);
  for (let guard = 0; guard < 10; guard++) {
    const m = value.match(/^var\((--[\w-]+)\)$/);
    if (!m) return value;
    const next = scope[m[1]!];
    if (!next) throw new Error(`Token absent : ${m[1]} (via ${name})`);
    value = next;
  }
  throw new Error(`Cycle de var() sur ${name}`);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.trim().replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`Couleur non littérale, non testable : ${hex}`);
  }
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** [encre, fond, seuil, intitulé] — le fond est toujours la surface réelle. */
const PAIRS: [string, string, number, string][] = [
  // Texte courant sur les deux surfaces de base
  ["--foreground", "--background", 4.5, "texte principal / fond"],
  ["--foreground", "--surface", 4.5, "texte principal / carte"],
  ["--foreground-secondary", "--surface", 4.5, "texte secondaire / carte"],
  ["--foreground-secondary", "--background", 4.5, "texte secondaire / fond"],
  // Statuts porteurs de chiffres : ils DOIVENT tenir le seuil texte
  ["--positive", "--surface", 4.5, "hausse / carte"],
  ["--negative", "--surface", 4.5, "baisse / carte"],
  ["--warning", "--surface", 4.5, "avertissement / carte"],
  ["--primary-text", "--surface", 4.5, "or lisible / carte"],
  ["--primary-text", "--background", 4.5, "or lisible / fond"],
  // Encre sur aplat doré (boutons)
  ["--primary-foreground", "--primary", 4.5, "encre sur aplat doré"],
  // Traits de graphique et sparklines — seuil non textuel
  ["--chart-positive", "--surface", 3, "courbe hausse / carte"],
  ["--chart-negative", "--surface", 3, "courbe baisse / carte"],
  ["--chart-gold", "--surface", 3, "courbe or / carte"],
  ["--chart-cyan", "--surface", 3, "courbe cyan / carte"],
];

describe("design system — contraste des tokens", () => {
  for (const [theme, scope] of [
    ["clair", LIGHT],
    ["sombre", DARK],
  ] as const) {
    describe(`thème ${theme}`, () => {
      for (const [ink, bg, threshold, label] of PAIRS) {
        it(`${label} ≥ ${threshold}:1`, () => {
          const ratio = contrast(
            resolveToken(scope, ink),
            resolveToken(scope, bg)
          );
          expect(
            ratio,
            `${ink} sur ${bg} = ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(threshold);
        });
      }
    });
  }

  it("le texte tertiaire reste lisible en usage non essentiel (≥ 3:1)", () => {
    // `--foreground-faint` ne porte que des libellés décoratifs (unités,
    // en-têtes de colonne répétés) : le seuil texte ne s'y applique pas, mais
    // il ne doit pas pour autant disparaître du fond.
    for (const [theme, scope] of [
      ["clair", LIGHT],
      ["sombre", DARK],
    ] as const) {
      const ratio = contrast(
        resolveToken(scope, "--foreground-faint"),
        resolveToken(scope, "--surface")
      );
      expect(ratio, `${theme} : ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("le thème sombre applique bien ses surfaces de référence", () => {
    /*
      Verrou anti-dérive : ces valeurs sont la référence visuelle validée.
      Les changer doit être un acte conscient, pas un effet de bord.

      Elles ont été révisées une fois, délibérément : le noir bleuté du mockup
      (#090909 / #111214 / #f3f2f0) est devenu un graphite chaud, l'or de la
      marque y paraissant moins jaune et l'écran moins dur à la longue. L'or
      lui-même n'a pas bougé — c'est l'accent, pas la surface.
    */
    expect(resolveToken(DARK, "--background")).toBe("#0c0b0a");
    expect(resolveToken(DARK, "--surface")).toBe("#161513");
    expect(resolveToken(DARK, "--foreground")).toBe("#ece9e3");
    expect(resolveToken(DARK, "--gold-base")).toBe("#d9a64d");
  });

  it("le thème clair applique bien ses surfaces de référence", () => {
    // Même verrou côté clair, où l'ivoire remplace le blanc pur : celui-ci
    // reste employé, mais comme sommet de la pile (modales, menus).
    expect(resolveToken(LIGHT, "--background")).toBe("#f4f2ed");
    expect(resolveToken(LIGHT, "--surface")).toBe("#fcfbf8");
    expect(resolveToken(LIGHT, "--surface-raised")).toBe("#ffffff");
    expect(resolveToken(LIGHT, "--foreground")).toBe("#14161a");
  });

  it("chaque niveau de surface se distingue du précédent sans sa bordure", () => {
    /*
      La hiérarchie de profondeur ne doit pas reposer entièrement sur les
      traits : une carte survolée dont la bordure s'éclaircit doit rester une
      carte. Le seuil est bas — il s'agit de nuances, pas de contraste — mais
      un écart nul signifierait deux niveaux confondus.
    */
    const MIN_STEP = 1.02;
    for (const [theme, scope] of [
      ["clair", LIGHT],
      ["sombre", DARK],
    ] as const) {
      const steps: [string, string][] = [
        ["--surface-sunken", "--background"],
        ["--background", "--surface"],
        ["--surface", "--surface-raised"],
      ];
      for (const [lower, upper] of steps) {
        const ratio = contrast(resolveToken(scope, lower), resolveToken(scope, upper));
        expect(
          ratio,
          `${theme} : ${lower} et ${upper} = ${ratio.toFixed(3)}:1`
        ).toBeGreaterThanOrEqual(MIN_STEP);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { hexRelativeLuminance, tileTextColor } from "@/components/dashboard/terminal-panels";

/*
  tileTextColor choisissait entre var(--foreground) et var(--background) sur
  un simple seuil de luminance (0,55). Les deux jetons sont *relatifs au
  thème* — foreground est l'encre sombre en clair mais l'encre claire en
  sombre, et inversement pour background — alors que les fonds posés dessus
  (couleurs de part, dashboard-tab.tsx ; couleurs par endroit,
  allocation-by-venue.ts) sont des hex fixes, identiques quel que soit le
  thème actif. Sur #d9a64d (Titres, la plus grande case de la mosaïque), ce
  seuil retenait le texte clair (var(--foreground) en thème sombre résout en
  #ece9e3, var(--background) en thème clair résout en #f4f2ed) et tombait à
  ~1,8:1 dans le thème où ce jeton se trouvait être clair — quasi illisible.

  Aucun des deux jetons ne peut être bon dans les deux thèmes à la fois pour
  un fond fixe : leur valeur change de polarité (clair/sombre) avec le thème,
  alors que la polarité qu'il faudrait pour le texte ne dépend que de la
  luminance du fond, qui ne change jamais. Noir et blanc purs sont les deux
  seules valeurs qui restent ce qu'elles sont dans les deux thèmes ; le choix
  entre les deux se fait ici en comparant le contraste réellement obtenu avec
  chacun, pas en refixant un seuil de luminance à une autre valeur (ce qui
  ne ferait que déplacer le problème vers une autre teinte).
*/

/** Couleurs de part réellement employées (dashboard-tab.tsx, D25). */
const PATRIMONY_COLORS: Record<string, string> = {
  Titres: "#d9a64d",
  "Immobilier net": "#1f9bb3",
  "Assurance-vie": "#2e9e63",
  "Épargne salariale": "#0d6f80",
  Crypto: "#b8860b",
  Alternatifs: "#7c5cbf",
  Liquidités: "#6b7280",
};

/** Couleurs « par endroit » réellement employées (allocation-by-venue.ts). */
const VENUE_COLORS: Record<string, string> = {
  pea: "#C4A35A",
  cto: "#8B7340",
  av: "#5B7C99",
  immo: "#7A5C4A",
  cash: "#8A93A0",
  es: "#6A7D8F",
  trading: "#8B4A4A",
  crypto: "#C47A4A",
  alt: "#8B6B7A",
  tangible: "#6B8F71",
};

function contrastOf(hex: string, textHex: "#ffffff" | "#000000"): number {
  const bg = hexRelativeLuminance(hex);
  const fg = textHex === "#ffffff" ? 1 : 0;
  const lighter = Math.max(bg, fg);
  const darker = Math.min(bg, fg);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("tileTextColor", () => {
  it("choisit un noir ou un blanc pur — les deux seules valeurs stables quel que soit le thème actif", () => {
    for (const hex of [...Object.values(PATRIMONY_COLORS), ...Object.values(VENUE_COLORS)]) {
      expect(["#ffffff", "#000000"]).toContain(tileTextColor(hex));
    }
  });

  it("atteint 4,5:1 (AA, texte normal) sur chaque couleur de part réellement employée", () => {
    for (const [label, hex] of Object.entries({ ...PATRIMONY_COLORS, ...VENUE_COLORS })) {
      const text = tileTextColor(hex) as "#ffffff" | "#000000";
      const contrast = contrastOf(hex, text);
      expect(contrast, `${label} (${hex}) : ${text} → ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("choisit le texte sombre sur #d9a64d (Titres) — le cas mesuré où l'ancien seuil (0,55) retenait le texte clair", () => {
    // Luminance ≈ 0,4256, sous l'ancien seuil de 0,55 : l'ancien code aurait
    // rendu var(--foreground), clair en thème sombre (contraste ≈ 1,8:1).
    expect(hexRelativeLuminance("#d9a64d")).toBeCloseTo(0.4256, 3);
    expect(tileTextColor("#d9a64d")).toBe("#000000");
    expect(contrastOf("#d9a64d", "#000000")).toBeGreaterThan(9);
  });

  it("choisit le texte clair sur un fond franchement sombre (Épargne salariale, allocation-by-venue)", () => {
    expect(tileTextColor("#0d6f80")).toBe("#ffffff");
    expect(tileTextColor("#8B4A4A")).toBe("#ffffff"); // trading
  });

  it("reste sur le repli var(--foreground)/var(--background) pour les jetons CSS non résolubles (allocationTone, perfTone)", () => {
    // Ces mosaïques ne passent jamais de hex fixe ici : le fond change avec
    // le thème par construction, donc le texte doit continuer à s'adapter
    // avec lui — c'est un cas différent de celui corrigé ci-dessus.
    expect(tileTextColor("var(--chart-gold)")).toBe("var(--foreground)");
    expect(tileTextColor("var(--chart-cyan)")).toBe("var(--background)");
    expect(tileTextColor("color-mix(in srgb, var(--chart-positive) 60%, var(--surface-raised))")).toBe(
      "var(--background)"
    );
  });

  it("ne fabrique pas de couleur sur une entrée illisible", () => {
    expect(hexRelativeLuminance("pas-une-couleur")).toBeNaN();
    expect(tileTextColor("pas-une-couleur")).toBe("var(--background)");
  });
});

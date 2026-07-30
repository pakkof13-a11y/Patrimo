import { describe, expect, it } from "vitest";
import {
  allocationColor,
  readableInkOn,
  stableColorFor,
} from "@/app/lib/portfolio/allocation-colors";

describe("allocationColor", () => {
  it("donne une couleur fixe par classe, indépendante de l'ordre d'affichage", () => {
    // Le même libellé doit rendre la même teinte, qu'il soit première ou
    // dernière part du portefeuille — c'était le bug de la coloration par rang.
    expect(allocationColor("Immobilier")).toBe(allocationColor("Immobilier"));
    expect(allocationColor("Actions / ETF")).not.toBe(
      allocationColor("Immobilier")
    );
  });

  /** Teinte HSL en degrés — seule mesure qui sépare l'ambre du rouge. */
  function hue(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  it("n'emploie ni vert ni rouge — réservés à la performance", () => {
    const labels = [
      "Actions / ETF",
      "Cryptomonnaies",
      "Immobilier",
      "Obligations",
      "Liquidités / Cash",
      "Autre",
    ];
    for (const label of labels) {
      const hex = allocationColor(label);
      const h = hue(hex);
      const isGrey = hex.toLowerCase() === "#64748b" || hex.toLowerCase() === "#94a3b8";
      if (isGrey) continue; // ardoise désaturée : aucune lecture de statut
      // Bande rouge/cramoisi (perte) et bande verte (gain), toutes deux exclues.
      expect(h >= 340 || h <= 20, `${label} est dans la bande rouge`).toBe(false);
      expect(h >= 90 && h <= 170, `${label} est dans la bande verte`).toBe(false);
    }
  });

  it("choisit une encre qui atteint le contraste AA sur chaque teinte", () => {
    const rel = (hex: string) => {
      const ch = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const r = ch(parseInt(hex.slice(1, 3), 16));
      const g = ch(parseInt(hex.slice(3, 5), 16));
      const b = ch(parseInt(hex.slice(5, 7), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const labels = [
      "Actions / ETF",
      "Cryptomonnaies",
      "Immobilier",
      "Obligations",
      "Liquidités / Cash",
      "Autre",
    ];
    for (const label of labels) {
      const bg = allocationColor(label);
      const ink = readableInkOn(bg);
      const l1 = Math.max(rel(bg), rel(ink));
      const l2 = Math.min(rel(bg), rel(ink));
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      expect(ratio, `${label} : contraste ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reste déterministe pour un nom libre (plateforme saisie par l'utilisateur)", () => {
    expect(stableColorFor("Boursorama")).toBe(stableColorFor("Boursorama"));
    expect(stableColorFor("")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

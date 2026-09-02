import { describe, expect, it } from "vitest";
import { CHART_COLORS, readableInkOn } from "@/app/lib/types/ui";

/**
 * Les tuiles de la mosaïque d'allocation écrivaient toujours en blanc, ce qui
 * passait sous le seuil WCAG AA (4.5:1) sur les teintes claires de la palette :
 * 3,19:1 sur l'ambre et 4,1:1 sur le bleu, mesuré sur le dashboard réel.
 */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const chan = (i: number) => {
    const v = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("readableInkOn", () => {
  it("atteint le seuil AA sur toute la palette graphique", () => {
    for (const bg of CHART_COLORS) {
      const ink = readableInkOn(bg);
      expect(
        contrast(ink, bg),
        `contraste insuffisant sur ${bg} avec ${ink}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("passe à l'encre foncée sur les teintes claires", () => {
    // Ambre et bleu : le blanc y échouait.
    expect(readableInkOn("#d97706")).toBe("#0b1220");
    expect(readableInkOn("#0284c7")).toBe("#0b1220");
  });

  it("garde le blanc sur les teintes sombres", () => {
    expect(readableInkOn("#0f766e")).toBe("#ffffff");
    expect(readableInkOn("#be123c")).toBe("#ffffff");
    expect(readableInkOn("#475569")).toBe("#ffffff");
  });

  it("choisit toujours le meilleur des deux", () => {
    for (const bg of [...CHART_COLORS, "#000000", "#ffffff", "#808080"]) {
      const ink = readableInkOn(bg);
      const other = ink === "#ffffff" ? "#0b1220" : "#ffffff";
      expect(contrast(ink, bg)).toBeGreaterThanOrEqual(contrast(other, bg));
    }
  });
});

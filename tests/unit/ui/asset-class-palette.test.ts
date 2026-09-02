import { describe, expect, it } from "vitest";
import {
  ASSET_CLASSES,
  ASSET_CLASS_CHART_COLORS,
  assetClassChartColor,
  assetClassLabel,
} from "@/app/lib/constants";

/**
 * Distance perceptuelle CIE76 dans l'espace Lab.
 *
 * Comparer des couleurs par leurs composantes RVB ne dit rien de ce que l'œil
 * distingue : deux gris très proches visuellement peuvent avoir un grand écart
 * RVB, et l'inverse est vrai aussi. En dessous de dE ≈ 25, deux teintes ne se
 * séparent pas de façon fiable dans des petits aplats côte à côte — ce qui est
 * exactement le cas des segments d'une colonne empilée.
 */
function labOf(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
  const A = labOf(a);
  const B = labOf(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

const MIN_DELTA_E = 25;

describe("palette des classes d'actifs (graphiques)", () => {
  it("couvre toutes les classes déclarées", () => {
    for (const cls of Object.keys(ASSET_CLASSES)) {
      expect(ASSET_CLASS_CHART_COLORS).toHaveProperty(cls);
    }
  });

  it("n'utilise que des couleurs hexadécimales — Recharts ne lit pas Tailwind", () => {
    for (const color of Object.values(ASSET_CLASS_CHART_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("garde toutes les paires distinguables dans une colonne empilée", () => {
    const entries = Object.entries(ASSET_CLASS_CHART_COLORS);
    const tooClose: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const d = deltaE(entries[i]![1], entries[j]![1]);
        if (d < MIN_DELTA_E) {
          tooClose.push(`${entries[i]![0]}/${entries[j]![0]} (dE=${d.toFixed(1)})`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("replie une classe inconnue sur « Autre » plutôt que sur du vide", () => {
    expect(assetClassChartColor("INEXISTANT")).toBe(
      ASSET_CLASS_CHART_COLORS.AUTRE
    );
    expect(assetClassChartColor("CRYPTO")).toBe(
      ASSET_CLASS_CHART_COLORS.CRYPTO
    );
  });

  it("replie un libellé inconnu sur le code brut", () => {
    expect(assetClassLabel("ACTIONS")).toBe("Actions / ETF");
    expect(assetClassLabel("INEXISTANT")).toBe("INEXISTANT");
  });
});

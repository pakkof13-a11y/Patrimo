"use client";

import { useId, useMemo } from "react";

/**
 * Sparkline SVG — trait seul ou trait + aire dégradée.
 *
 * Volontairement hors Recharts : ces courbes n'ont ni axe, ni info-bulle, ni
 * interaction, et l'interface en affiche une quinzaine simultanément (bandeau
 * marchés, tuiles KPI, watchlist). Un `polyline` normalisé rend le même
 * résultat pour une fraction du coût de montage.
 *
 * Le tracé n'est jamais lissé : il relie les points réels. Une courbe de
 * patrimoine adoucie masquerait précisément les décrochages qu'on cherche à
 * repérer d'un coup d'œil.
 */
export function Sparkline({
  values,
  stroke,
  fill = false,
  width = 64,
  height = 20,
  strokeWidth = 1.25,
  className,
}: {
  values: number[];
  /** Couleur du trait — toujours un token (`var(--chart-…)`). */
  stroke: string;
  /** Aire dégradée sous la courbe (tuiles KPI, carte patrimoine). */
  fill?: boolean;
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const gradientId = useId();

  const { line, area } = useMemo(() => {
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length < 2) return { line: "", area: "" };
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    const stepX = width / (clean.length - 1);
    // Marge d'un demi-trait en haut et en bas : sans elle, un maximum ou un
    // minimum se retrouve rogné par le bord du viewBox.
    const pad = strokeWidth;
    const usable = height - pad * 2;
    const pts = clean.map((v, i) => {
      const x = i * stepX;
      const y = pad + usable - ((v - min) / span) * usable;
      return [x, y] as const;
    });
    const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `${line} ${width.toFixed(2)},${height} 0,${height}`;
    return { line, area };
  }, [values, width, height, strokeWidth]);

  if (!line) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
      className={className}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

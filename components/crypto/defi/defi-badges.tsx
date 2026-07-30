"use client";

import { cn } from "@/app/lib/utils";
import type { BadgeSpec, BadgeTone } from "@/app/lib/crypto/defi-ui-rules";

/**
 * Rendu des badges standardisés — une seule implémentation visuelle pour tous
 * les badges du module (tableau, détail). Le texte du badge porte toujours le
 * sens : la couleur ne fait que renforcer, jamais porter seule l'information
 * (règle d'accessibilité explicite du cahier des charges).
 */
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-[var(--border)] text-[var(--muted-foreground)]",
  info: "border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--foreground)]",
  success: "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]",
  warning: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  critical: "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]",
};

export function DefiBadge({ badge }: { badge: BadgeSpec }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        TONE_CLASSES[badge.tone]
      )}
      title={badge.title}
      data-testid={`defi-badge-${badge.key}`}
      tabIndex={badge.title ? 0 : undefined}
    >
      {badge.label}
    </span>
  );
}

export function DefiBadgeList({
  badges,
  className,
}: {
  badges: BadgeSpec[];
  className?: string;
}) {
  if (badges.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {badges.map((b) => (
        <DefiBadge key={b.key} badge={b} />
      ))}
    </div>
  );
}

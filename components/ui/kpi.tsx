"use client";

import { cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Tuile KPI — hiérarchie : libellé discret → valeur forte.
 * Densité maîtrisée pour bandeaux 6–8 indicateurs.
 */
export function Kpi({
  icon,
  label,
  value,
  tone,
  testId,
  accent = false,
  muted = false,
  loading = false,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: string;
  tone?: "up" | "down";
  testId?: string;
  /**
   * Met la tuile en avant : fond teinté, liseré, valeur agrandie.
   * Réservé à l'indicateur de tête d'un bandeau — le patrimoine net avait
   * exactement le même poids visuel que sept autres tuiles, en dernière
   * position, alors que c'est le chiffre que l'on vient lire en premier.
   */
  accent?: boolean;
  /**
   * Tuile à valeur ~nulle (smartFilter) : on la garde montée pour ne pas
   * casser la grille ni la faire disparaître/réapparaître au fil des
   * chargements, mais on l'efface visuellement.
   */
  muted?: boolean;
  /**
   * Donnée pas encore arrivée.
   *
   * La tuile reste montée — la grille ne doit pas bouger au fil des
   * chargements — mais sa valeur cède la place à un placeholder. Sans cela,
   * une donnée absente s'affichait comme un montant réel : `0,00 €` sur le
   * patrimoine net est le pire mensonge que cet écran puisse produire.
   */
  loading?: boolean;
}) {
  return (
    <div
      className={cn(
        "kpi-tile flex min-h-[5.25rem] min-w-0 flex-col justify-between gap-2 p-3 sm:p-3.5",
        accent &&
          "bg-[var(--gold-muted)] ring-1 ring-inset ring-[var(--gold-2)]/25",
        // Ni liseré de tendance ni estompage tant qu'aucune valeur n'est
        // connue : les deux affirmeraient quelque chose sur une donnée absente.
        !loading && tone === "up" &&
          "border-l-[3px] border-l-[var(--success)]/80 dark:border-l-[var(--success)]/70",
        !loading && tone === "down" &&
          "border-l-[3px] border-l-[var(--danger)]/75 dark:border-l-[var(--danger)]/65",
        !loading && muted && "opacity-50"
      )}
      data-testid={testId}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading || undefined}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="mt-0.5 shrink-0 text-[var(--muted-foreground)] opacity-75 [&_svg]:h-3.5 [&_svg]:w-3.5"
          aria-hidden
        >
          {icon}
        </span>
        <span className="text-label min-w-0 leading-snug break-words normal-case tracking-wide">
          {label}
        </span>
      </div>
      {loading ? (
        // Même gabarit que la valeur : la tuile garde sa hauteur, rien ne saute
        // quand le montant arrive.
        <Skeleton className="h-[1.05rem] w-3/5 sm:h-[1.125rem] xl:h-[1.2rem]" />
      ) : (
        <div
          className={cn(
            "kpi-value min-w-0 leading-none break-words",
            accent
              ? "kpi-value--primary text-[1.2rem] sm:text-xl xl:text-[1.4rem]"
              : "text-[1.05rem] sm:text-lg xl:text-[1.2rem]",
            muted
              ? "text-[var(--muted-foreground)]"
              : tone === "up"
                ? "text-[var(--success)]"
                : tone === "down"
                  ? "text-[var(--danger)]"
                  : !accent && "text-[var(--foreground)]"
          )}
        >
          {value}
        </div>
      )}
    </div>
  );
}

export function Stat({
  label,
  value,
  compact,
  tone,
}: {
  label: string;
  value: string;
  /** Densité réduite (cartes imbriquées) */
  compact?: boolean;
  /** Couleur de la valeur uniquement (P&L / %) */
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div className={cn("min-w-0", compact ? "space-y-0.5" : "space-y-1")}>
      <div
        className={cn(
          "text-label normal-case tracking-wide",
          compact && "text-[10px]"
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "kpi-value tabular-nums",
          compact ? "text-sm sm:text-base" : "text-lg",
          tone === "up" && "text-[var(--success)]",
          tone === "down" && "text-[var(--danger)]",
          (!tone || tone === "neutral") && "text-[var(--foreground)]"
        )}
      >
        {value}
      </div>
    </div>
  );
}

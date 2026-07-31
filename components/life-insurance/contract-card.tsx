"use client";

import { CalendarClock, ChevronRight } from "lucide-react";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Sparkline } from "@/components/ui/sparkline";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import {
  upcomingMilestones,
  weightedManagementFeePct,
  type ContractView,
} from "@/app/lib/life-insurance/overview";
import type { ContractSeries } from "@/app/lib/life-insurance/performance-service";

/**
 * Un contrat, en carte.
 *
 * Une ligne de tableau range des contrats ; une carte en présente un. La
 * différence compte ici parce qu'un contrat d'assurance-vie n'est pas une
 * position : il a un âge, une fiscalité, une répartition, des échéances — six
 * informations de natures différentes qu'une grille de colonnes aplatirait.
 *
 * La carte entière est cliquable et ouvre le contrat en panneau latéral. Elle
 * reste un `<button>` : c'est une action, pas un lien vers une autre page, et
 * le clavier doit pouvoir l'atteindre comme le reste.
 */

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

/**
 * Barre de répartition fonds euro / UC / structurés.
 *
 * Les trois poches partagent une seule barre plutôt que trois jauges : c'est
 * un partage à 100 %, et trois barres indépendantes laisseraient croire à
 * trois mesures indépendantes.
 */
function AllocationBar({ view }: { view: ContractView }) {
  const slices = view.allocation.filter((a) => (a.sharePct ?? 0) > 0);
  if (slices.length === 0) {
    return (
      <div
        className="h-[0.35rem] w-full rounded-full bg-[var(--surface-sunken)]"
        aria-hidden
      />
    );
  }
  const tone: Record<string, string> = {
    FONDS_EURO: "var(--chart-gold)",
    UC: "var(--chart-cyan)",
    STRUCTURED: "var(--chart-neutral)",
  };
  return (
    <div
      className="flex h-[0.35rem] w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      role="img"
      aria-label={slices
        .map(
          (s) =>
            `${s.label} ${(s.sharePct ?? 0).toLocaleString("fr-FR", {
              maximumFractionDigits: 0,
            })} %`
        )
        .join(", ")}
    >
      {slices.map((s) => (
        <span
          key={s.bucket}
          style={{
            width: `${s.sharePct}%`,
            background: tone[s.bucket],
          }}
        />
      ))}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-label truncate">{label}</p>
      <p
        className={cn(
          "num truncate text-[length:var(--text-sm)] font-medium",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          !tone && "text-[var(--foreground)]"
        )}
        title={title}
      >
        {value}
      </p>
    </div>
  );
}

export function ContractCard({
  view,
  series,
  onOpen,
}: {
  view: ContractView;
  /** Série de performance du contrat, si des cours existent. */
  series?: ContractSeries;
  onOpen: (contractId: string) => void;
}) {
  const fee = weightedManagementFeePct(view.supports);
  const milestones = upcomingMilestones(view.supports);
  const perf = series?.performancePct ?? null;
  const spark =
    series && series.points.length >= 2
      ? series.points.map((p) => p.index)
      : undefined;
  const gainUp = view.unrealizedGainEur >= 0;

  return (
    /*
      La carte n'est pas un bouton : elle contient une liste et une barre de
      répartition, que le modèle de contenu interdit à l'intérieur d'un
      élément interactif. C'est donc le titre qui porte le bouton, étendu à
      toute la carte par un pseudo-élément — un vrai contrôle pour le clavier
      et le lecteur d'écran, une surface entière pour la souris.
    */
    <article
      className={cn(
        "panel panel--interactive relative w-full p-[var(--pad-card)] text-left",
        "focus-within:border-[var(--border-strong)]"
      )}
      data-testid="av-contract-card"
      data-contract-id={view.policy.id}
    >
      {/* ── Identité ───────────────────────────────────────────── */}
      <div className="flex min-w-0 items-start gap-[var(--space-3)]">
        <PlatformLogo name={view.title} size={32} />
        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-[length:var(--text-base)] font-medium text-[var(--foreground)]"
            data-testid="av-contract-title"
          >
            <button
              type="button"
              onClick={() => onOpen(view.policy.id)}
              className={cn(
                "block w-full truncate text-left",
                "after:absolute after:inset-0 after:rounded-[var(--radius-lg)]",
                "focus-visible:outline focus-visible:outline-2",
                "focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              )}
              title={view.title}
              aria-label={`Ouvrir le contrat ${view.title}`}
              data-testid="av-contract-open"
            >
              {view.title}
            </button>
          </h3>
          <p
            className="text-meta truncate"
            title={`${view.contractType}${
              view.policy.openDate
                ? ` · ouvert le ${formatDate(view.policy.openDate)}`
                : ""
            }`}
          >
            {view.contractType}
            {view.policy.openDate
              ? ` · ouvert ${formatDate(view.policy.openDate)}`
              : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-[length:var(--text-lg)] font-semibold text-[var(--foreground)]">
            {formatCurrency(view.valueEur, "EUR")}
          </p>
          <p
            className={cn(
              "num text-[length:var(--text-xs)]",
              perf != null
                ? perf >= 0
                  ? "val-positive"
                  : "val-negative"
                : "text-[var(--foreground-faint)]"
            )}
          >
            {perf != null ? formatSignedPct(perf) : "Perf. indisponible"}
          </p>
        </div>
        <ChevronRight
          className="mt-[var(--space-1)] h-4 w-4 shrink-0 text-[var(--foreground-faint)]"
          aria-hidden
        />
      </div>

      {/* ── Répartition ────────────────────────────────────────── */}
      <div className="mt-[var(--space-4)]">
        <AllocationBar view={view} />
        <div className="text-meta mt-[var(--space-2)] flex flex-wrap gap-x-[var(--space-3)] gap-y-[var(--space-1)]">
          {view.allocation
            .filter((a) => (a.sharePct ?? 0) > 0)
            .map((a) => (
              <span key={a.bucket} className="whitespace-nowrap">
                {a.label}{" "}
                <span className="num text-[var(--foreground-secondary)]">
                  {(a.sharePct ?? 0).toLocaleString("fr-FR", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  %
                </span>
              </span>
            ))}
        </div>
      </div>

      {/* ── Mesures + sparkline ────────────────────────────────── */}
      <div className="mt-[var(--space-4)] flex items-end gap-[var(--space-4)]">
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-[var(--space-3)]">
          <Metric
            label="Plus-value"
            value={`${gainUp ? "+" : "−"}${formatCurrency(Math.abs(view.unrealizedGainEur), "EUR")}`}
            tone={gainUp ? "positive" : "negative"}
          />
          <Metric
            label="Frais"
            value={
              fee != null
                ? `${fee.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`
                : "—"
            }
            title={
              fee == null
                ? "Aucun support ne renseigne ses frais de gestion"
                : "Moyenne pondérée par l'encours de chaque support"
            }
          />
          <Metric
            label="Antériorité"
            value={
              view.ageYears != null
                ? `${Math.floor(view.ageYears)} an${Math.floor(view.ageYears) > 1 ? "s" : ""}`
                : "—"
            }
            title={
              view.isMature === true
                ? "Plan de plus de 8 ans : abattement annuel sur les gains d'un rachat"
                : view.isMature === false
                  ? "Moins de 8 ans : pas encore d'abattement annuel"
                  : "Date d'ouverture non renseignée"
            }
          />
        </div>

        <div className="h-[2rem] w-[6rem] shrink-0">
          {spark && (
            <Sparkline
              values={spark}
              stroke={
                perf != null && perf < 0
                  ? "var(--chart-negative)"
                  : "var(--chart-positive)"
              }
              width={96}
              height={32}
              className="h-full w-full"
            />
          )}
        </div>
      </div>

      {/* ── Prochaines échéances ───────────────────────────────── */}
      {milestones.length > 0 && (
        <ul
          className="text-meta mt-[var(--space-3)] flex flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-1)] border-t border-[var(--border-subtle)] pt-[var(--space-3)]"
          data-testid="av-contract-milestones"
        >
          {milestones.map((m) => (
            <li
              key={`${m.supportName}-${m.kind}-${m.dateIso}`}
              className="flex min-w-0 items-center gap-[var(--space-1)]"
            >
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">
                {m.label} {m.supportName} —{" "}
                <span className="num">{formatDate(m.dateIso)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

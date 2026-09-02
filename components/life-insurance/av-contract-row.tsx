"use client";

/**
 * Ligne d'un contrat d'assurance-vie.
 *
 * Les contrats étaient des cartes de treize centimètres de haut, deux par
 * rangée : trois contrats et il fallait faire défiler pour les comparer. La
 * comparaison est pourtant la seule chose qu'on fait sur cette page — quel
 * contrat porte quoi, lequel performe, lequel a passé les huit ans.
 *
 * La ligne garde tout ce que portait la carte — identité, valeur, part,
 * performance, versements, répartition, repères fiscaux — mais alignée, donc
 * comparable d'un coup d'œil. C'est le même arbitrage que le tableau du
 * Portefeuille et la liste des Banques.
 */

import { PlatformLogo } from "@/components/ui/platform-logo";
import { Sparkline } from "@/components/ui/sparkline";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { ContractView } from "@/app/lib/life-insurance/overview";
import type { PerformancePoint } from "@/app/lib/life-insurance/performance";

type ContractSeries = {
  points?: PerformancePoint[];
  performancePct?: number | null;
};

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })} %`;

const dateFr = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

/** Teinte par poche d'épargne — la même d'un écran à l'autre. */
const BUCKET_COLOR: Record<string, string> = {
  FONDS_EURO: "var(--chart-3)",
  UC: "var(--chart-1)",
  STRUCTURED: "var(--chart-4)",
};

/**
 * Répartition en une barre segmentée.
 *
 * Un camembert de dix-huit pixels ne se lit pas ; une barre, si. Les segments
 * suivent l'ordre fixe des poches (fonds euro, UC, structurés) pour que la
 * lecture reste la même d'un contrat au suivant.
 */
function AllocationBar({ view }: { view: ContractView }) {
  const slices = view.allocation.filter((a) => (a.sharePct ?? 0) > 0);
  if (slices.length === 0) {
    return <span className="text-meta">—</span>;
  }
  return (
    <div className="min-w-0">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]"
        role="img"
        aria-label={slices
          .map((s) => `${s.label} ${Math.round(s.sharePct ?? 0)} %`)
          .join(", ")}
      >
        {slices.map((s) => (
          <span
            key={s.bucket}
            style={{
              width: `${s.sharePct ?? 0}%`,
              background: BUCKET_COLOR[s.bucket] ?? "var(--chart-2)",
            }}
          />
        ))}
      </div>
      <p className="text-meta mt-[var(--space-1)] truncate">
        {slices
          .map(
            (s) =>
              `${s.label} ${Math.round(s.sharePct ?? 0)} %`
          )
          .join(" · ")}
      </p>
    </div>
  );
}

/** Repère compact — fiscalité, horizon, nombre de supports. */
function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]"
      title={title}
    >
      {children}
    </span>
  );
}

export function AvContractRow({
  view,
  series,
  selected,
  onSelect,
}: {
  view: ContractView;
  series?: ContractSeries;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const perf = series?.performancePct ?? null;
  const points = (series?.points ?? [])
    .map((p) => Number(p.valueEur))
    .filter((n) => Number.isFinite(n));

  const opened = dateFr(view.policy.openDate);

  return (
    <li>
      <button
        type="button"
        className={cn("av-contract-row", selected && "is-selected")}
        onClick={() => onSelect(view.policy.id)}
        aria-current={selected ? "true" : undefined}
        data-testid="av-contract-row"
      >
        {/* Identité */}
        <span className="flex min-w-0 items-center gap-[var(--space-3)]">
          <PlatformLogo name={view.policy.insurer || view.title} size={28} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-[var(--space-2)]">
              <span className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
                {view.title}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--success-soft,var(--surface-sunken))] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
                Ouvert
              </span>
            </span>
            <span className="text-meta block truncate">
              {view.contractType}
              {opened ? ` · ouvert le ${opened}` : ""}
            </span>
            <span className="mt-[var(--space-1)] flex flex-wrap gap-[var(--space-1)]">
              {view.isMature != null && (
                <Chip
                  title={
                    view.isMature
                      ? "Contrat de plus de huit ans : abattement annuel applicable"
                      : "Contrat de moins de huit ans : pas d'abattement"
                  }
                >
                  {view.isMature ? "+8 ans" : "−8 ans"}
                </Chip>
              )}
              {view.ageYears != null && (
                <Chip title="Ancienneté fiscale du contrat">
                  {view.ageYears.toLocaleString("fr-FR", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  ans
                </Chip>
              )}
              <Chip title="Supports rattachés à ce contrat">
                {view.supports.length} support
                {view.supports.length > 1 ? "s" : ""}
              </Chip>
            </span>
          </span>
        </span>

        {/* Valeur */}
        <span className="text-right">
          <span className="num block text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
            {formatCurrency(view.valueEur, "EUR")}
          </span>
          <span className="text-meta block">
            {view.sharePct != null
              ? `${view.sharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de l'AV`
              : "—"}
          </span>
        </span>

        {/* Performance */}
        <span className="flex items-center justify-end gap-[var(--space-2)]">
          {points.length > 1 ? (
            <Sparkline
              values={points}
              width={56}
              height={18}
              stroke={
                (perf ?? 0) >= 0 ? "var(--success)" : "var(--danger)"
              }
            />
          ) : null}
          <span
            className={cn(
              "num text-[length:var(--text-xs)] font-medium",
              perf == null
                ? "text-[var(--foreground-faint)]"
                : perf >= 0
                  ? "val-positive"
                  : "val-negative"
            )}
          >
            {pctLabel(perf)}
          </span>
        </span>

        {/* Versements nets */}
        <span className="num text-right text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
          {view.premiumsEur > 0
            ? formatCurrency(view.premiumsEur, "EUR")
            : "—"}
        </span>

        {/* Répartition */}
        <span className="min-w-0">
          <AllocationBar view={view} />
        </span>
      </button>
    </li>
  );
}

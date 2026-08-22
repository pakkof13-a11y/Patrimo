"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Gem,
  Handshake,
  LayoutDashboard,
  Palette,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  type AlternativesDashboardPayload,
  type AlternativesSubTab,
} from "@/app/lib/alternatives/types";
import { AlternativesMetals } from "@/components/tabs/alternatives-metals";
import { AlternativesPrivateEquity } from "@/components/tabs/alternatives-private-equity";
import { AlternativesCrowdlending } from "@/components/tabs/alternatives-crowdlending";
import { AlternativesTangibles } from "@/components/tabs/alternatives-tangibles";
import {
  CATEGORY_LABEL,
  CATEGORY_SUB,
  computeAlternativesTotals,
  type AlternativeCategory,
} from "@/app/lib/alternatives/consolidated";
import { AlternativeDetailPanel } from "@/components/tabs/alternatives-panel";

const SUB_NAV: {
  id: AlternativesSubTab;
  label: string;
  short: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "dashboard",
    label: "Vue d’ensemble",
    short: "Dashboard",
    icon: <LayoutDashboard className="h-3.5 w-3.5" />,
  },
  {
    id: "metals",
    label: "Métaux précieux",
    short: "Métaux",
    icon: <Gem className="h-3.5 w-3.5" />,
  },
  {
    id: "private-equity",
    label: "Private Equity",
    short: "PE",
    icon: <Building2 className="h-3.5 w-3.5" />,
  },
  {
    id: "crowdlending",
    label: "Crowdlending",
    short: "Prêts",
    icon: <Handshake className="h-3.5 w-3.5" />,
  },
  {
    id: "tangibles",
    label: "Tangibles & collection",
    short: "Tangibles",
    icon: <Palette className="h-3.5 w-3.5" />,
  },
];

const ALT_SUBS = new Set<string>([
  "dashboard",
  "metals",
  "private-equity",
  "crowdlending",
  "tangibles",
]);

function fmtPctShort(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

/** Teinte par famille — la même dans la barre, la légende et la liste. */
const CATEGORY_TONE: Record<AlternativeCategory, string> = {
  METAL: "var(--chart-gold)",
  PRIVATE_EQUITY: "var(--chart-cyan)",
  CROWDLENDING: "var(--chart-positive)",
  TANGIBLE: "var(--chart-neutral)",
};

/** Tuile de tête — même grammaire que les autres modules patrimoniaux. */
function AltKpi({
  label,
  value,
  secondary,
  tone,
  loading,
  testId,
}: {
  label: string;
  value: string;
  secondary?: string;
  tone?: "positive" | "negative";
  loading?: boolean;
  testId: string;
}) {
  return (
    <div
      className="min-w-0 px-[var(--space-4)] py-[var(--space-3)]"
      data-testid={testId}
    >
      {loading ? (
        <Skeleton className="h-6 w-24" />
      ) : (
        <p
          className={cn(
            "num truncate text-[length:var(--text-lg)] font-semibold tracking-tight",
            tone === "positive" && "val-positive",
            tone === "negative" && "val-negative",
            !tone && "text-[var(--foreground)]"
          )}
        >
          {value}
        </p>
      )}
      <p className="text-label mt-[var(--space-1)]">{label}</p>
      {secondary && !loading ? (
        <p className="text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
          {secondary}
        </p>
      ) : null}
    </div>
  );
}

export function AlternativesTab({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const searchParams = useSearchParams();
  // Init depuis l'URL (?sub=) dès le 1er rendu — honore le deep-link au montage
  const [sub, setSub] = useState<AlternativesSubTab>(() => {
    const q = (searchParams.get("sub") || "").toLowerCase();
    return ALT_SUBS.has(q) ? (q as AlternativesSubTab) : "dashboard";
  });

  // Sync depuis l'URL quand elle change (deep-link) — même motif que
  // l'onglet Trading : ajustement d'état pendant le render (pattern React
  // recommandé pour dériver un state d'un prop qui change), pas un
  // useEffect + setState qui déclencherait des rendus en cascade
  // (règle ESLint react-hooks/set-state-in-effect). `sub` reste par
  // ailleurs togglable manuellement.
  const subParamKey = searchParams.toString();
  const [prevSubParamKey, setPrevSubParamKey] = useState(subParamKey);
  if (subParamKey !== prevSubParamKey) {
    setPrevSubParamKey(subParamKey);
    const q = (searchParams.get("sub") || "").toLowerCase();
    if (ALT_SUBS.has(q)) setSub(q as AlternativesSubTab);
  }

  /** Dashboard : 1 seul HTTP (bundle). Sous-modules : listes lazy au besoin. */
  const dashQ = useQuery({
    queryKey: ["alternatives-summary", "dashboard"],
    queryFn: () =>
      fetchJson<AlternativesDashboardPayload>("/api/alternatives/summary"),
    enabled: sub === "dashboard",
    staleTime: 60_000,
  });

  /*
    Positions consolidées et agrégats de la poche.

    Le payload porte désormais les lignes des quatre familles — déjà chargées
    côté serveur pour en tirer les summaries, puis jetées jusqu'ici. Les
    consolider ne coûte donc aucune requête, et évite quatre appels réseau au
    montage de la vue d'ensemble.
  */
  const investments = useMemo(
    () => dashQ.data?.investments ?? [],
    [dashQ.data?.investments]
  );
  const totals = useMemo(
    () => computeAlternativesTotals(investments),
    [investments]
  );

  /*
    Alertes — construites côté métier (`buildAlternativesShortAlerts`) à partir
    des summaries : retards et défauts de crowdlending, échéances proches, NAV
    de private equity non rafraîchies. Aucun compteur n'est recalculé ici.
  */
  const shortAlerts = useMemo(
    () => dashQ.data?.shortAlerts ?? [],
    [dashQ.data?.shortAlerts]
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedInvestment = useMemo(
    () =>
      investments.find((i) => `${i.category}:${i.id}` === selectedKey) ?? null,
    [investments, selectedKey]
  );

  function goModule(id: AlternativesSubTab) {
    setSub(id);
  }

  return (
    <div className="min-w-0 space-y-[var(--space-4)]" data-testid="alternatives-tab">
      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="module-page-header flex flex-wrap items-start justify-between gap-[var(--space-3)] px-0.5">
        <div className="min-w-0">
          <h1 className="text-title">Actifs alternatifs</h1>
          <p className="text-meta">
            Diversification hors marchés cotés
            {totals.count > 0 ? (
              <>
                <span className="mx-1 opacity-40">·</span>
                {totals.count} investissement{totals.count > 1 ? "s" : ""}
                <span className="mx-1 opacity-40">·</span>
                {totals.byCategory.length} famille
                {totals.byCategory.length > 1 ? "s" : ""}
              </>
            ) : null}
          </p>
        </div>
      </header>

      {/* ── KPI consolidés ───────────────────────────────────────── */}
      <div
        className="card grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5"
        data-testid="alt-kpi-strip"
      >
        <AltKpi
          testId="alt-kpi-value"
          label="Valeur totale"
          value={formatCurrency(String(totals.valueEur), baseCurrency)}
          secondary="Poche alternative"
          loading={dashQ.isPending}
        />
        <AltKpi
          testId="alt-kpi-invested"
          label="Investi"
          value={formatCurrency(String(totals.investedEur), baseCurrency)}
          secondary="Capital engagé"
          loading={dashQ.isPending}
        />
        <AltKpi
          testId="alt-kpi-pnl"
          label="Résultat"
          value={formatCurrency(String(totals.pnlEur), baseCurrency)}
          secondary={fmtPctShort(totals.pnlPct)}
          tone={totals.pnlEur >= 0 ? "positive" : "negative"}
          loading={dashQ.isPending}
        />
        <AltKpi
          testId="alt-kpi-count"
          label="Investissements"
          value={String(totals.count)}
          secondary={`${totals.byCategory.length} famille${totals.byCategory.length > 1 ? "s" : ""}`}
          loading={dashQ.isPending}
        />
        <AltKpi
          testId="alt-kpi-alerts"
          label="Alertes"
          value={String(shortAlerts.reduce((s, a) => s + a.count, 0))}
          secondary={
            shortAlerts.length > 0 ? "À examiner" : "Rien à signaler"
          }
          tone={shortAlerts.length > 0 ? "negative" : undefined}
          loading={dashQ.isPending}
        />
      </div>

      {/* ── Sous-navigation ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <div
          className="term-seg"
          role="tablist"
          aria-label="Sous-modules actifs alternatifs"
        >
          {SUB_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={sub === item.id}
              data-active={sub === item.id}
              className="term-seg-item"
              data-testid={`alt-sub-${item.id}`}
              onClick={() => setSub(item.id)}
            >
              <span className="hidden sm:inline">{item.label}</span>
              <span className="sm:hidden">{item.short}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Vue d'ensemble ───────────────────────────────────────── */}
      {sub === "dashboard" && (
        <div
          className="grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start"
          data-testid="alt-dashboard"
        >
          <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
            {/* Répartition de la poche */}
            {totals.byCategory.length > 0 && (
              <section
                className="card min-w-0 p-[var(--space-4)]"
                data-testid="alt-split"
              >
                <h2 className="text-label mb-[var(--space-2)]">Répartition</h2>
                <div
                  className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]"
                  role="img"
                  aria-label={totals.byCategory
                    .map((c) => `${c.label} ${Math.round(c.sharePct ?? 0)} %`)
                    .join(", ")}
                >
                  {totals.byCategory.map((c) => (
                    <span
                      key={c.category}
                      style={{
                        width: `${c.sharePct ?? 0}%`,
                        background: CATEGORY_TONE[c.category],
                      }}
                    />
                  ))}
                </div>
                <ul className="mt-[var(--space-3)] grid gap-[var(--space-1)] sm:grid-cols-2">
                  {totals.byCategory.map((c) => (
                    <li key={c.category}>
                      <button
                        type="button"
                        className="flex w-full items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)] text-left transition-[color] hover:text-[var(--primary-text)]"
                        onClick={() =>
                          goModule(CATEGORY_SUB[c.category] as AlternativesSubTab)
                        }
                        data-testid="alt-split-row"
                      >
                        <span className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: CATEGORY_TONE[c.category] }}
                            aria-hidden
                          />
                          {c.label}
                        </span>
                        <span className="num shrink-0 text-[length:var(--text-xs)]">
                          {formatCurrency(String(c.valueEur), baseCurrency)}
                          <span className="text-meta ml-[var(--space-2)]">
                            {fmtPctShort(c.sharePct)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/*
              Alertes.

              Elles viennent de `shortAlerts`, déjà construit côté métier à
              partir des summaries — aucun compteur n'est recalculé ici. Une
              ligne compacte et cliquable plutôt qu'une bannière : ce sont des
              faits à examiner, pas une urgence à crier.
            */}
            {shortAlerts.length > 0 && (
              <section
                className="card min-w-0 p-[var(--space-4)]"
                data-testid="alt-alerts"
              >
                <h2 className="text-label mb-[var(--space-2)]">Alertes</h2>
                <ul className="divide-y divide-[var(--border)]">
                  {shortAlerts.map((a) => (
                    <li key={a.type}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-[var(--space-3)] py-[var(--space-2)] text-left transition-[color] hover:text-[var(--foreground)]"
                        onClick={() => goModule(a.sub)}
                        data-testid={`alt-alert-${a.type}`}
                      >
                        <span className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                          <AlertTriangle
                            className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]"
                            aria-hidden
                          />
                          {a.label}
                        </span>
                        <span className="num shrink-0 text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                          {a.count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Liste consolidée */}
            <section
              className="card min-w-0 overflow-hidden"
              data-testid="alt-investments"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
                <h2 className="text-label">Investissements</h2>
                <span className="text-meta num">
                  {formatCurrency(String(totals.valueEur), baseCurrency)}
                </span>
              </div>

              {dashQ.isPending ? (
                <div className="space-y-[var(--space-2)] p-[var(--space-4)]">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : investments.length === 0 ? (
                <div className="p-[var(--space-4)]" data-testid="alt-empty">
                  <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                    Aucun investissement alternatif
                  </p>
                  <p className="text-meta mt-[var(--space-1)] max-w-prose">
                    Métaux, private equity, crowdlending et tangibles se
                    saisissent depuis leur sous-module. Chacun garde ses
                    indicateurs propres : un lingot n&apos;a pas de TVPI, un
                    prêt n&apos;a pas de prime.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="term-table" data-testid="alt-investments-table">
                    <thead>
                      <tr>
                        <th>Investissement</th>
                        <th>Catégorie</th>
                        <th>Plateforme</th>
                        <th className="text-right">Valeur</th>
                        <th className="text-right">Investi</th>
                        <th className="text-right">Perf.</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {investments.map((i) => {
                        const key = `${i.category}:${i.id}`;
                        return (
                          <tr
                            key={key}
                            className={cn(
                              "alt-row",
                              selectedKey === key && "is-selected"
                            )}
                            onClick={() => setSelectedKey(key)}
                            aria-current={
                              selectedKey === key ? "true" : undefined
                            }
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedKey(key);
                              }
                            }}
                            data-testid="alt-investment-row"
                          >
                            <td>
                              <span className="block truncate font-medium text-[var(--foreground)]">
                                {i.name}
                              </span>
                              {i.subtitle ? (
                                <span className="text-meta block truncate">
                                  {i.subtitle}
                                </span>
                              ) : null}
                            </td>
                            <td className="text-[var(--foreground-secondary)]">
                              {CATEGORY_LABEL[i.category]}
                            </td>
                            <td className="text-[var(--foreground-secondary)]">
                              {i.platform?.trim() || "—"}
                            </td>
                            <td className="num text-right font-medium">
                              {formatCurrency(String(i.valueEur), i.currency)}
                            </td>
                            <td className="num text-right">
                              {formatCurrency(String(i.investedEur), i.currency)}
                            </td>
                            <td
                              className={cn(
                                "num text-right",
                                i.pnlPct != null &&
                                  i.pnlPct >= 0 &&
                                  "val-positive",
                                i.pnlPct != null && i.pnlPct < 0 && "val-negative"
                              )}
                            >
                              {i.pnlPct != null
                                ? `${i.pnlPct >= 0 ? "+" : "−"}${Math.abs(i.pnlPct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                                : "—"}
                            </td>
                            <td>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-2xs)]",
                                  i.statusIsAlert
                                    ? "text-[var(--danger)]"
                                    : "text-[var(--foreground-secondary)]"
                                )}
                              >
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{
                                    background: i.statusIsAlert
                                      ? "var(--danger)"
                                      : "var(--success)",
                                  }}
                                  aria-hidden
                                />
                                {i.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <AlternativeDetailPanel
            investment={selectedInvestment}
            onClose={() => setSelectedKey(null)}
          />
        </div>
      )}

      {sub === "metals" && <AlternativesMetals baseCurrency={baseCurrency} />}

      {sub === "private-equity" && (
        <AlternativesPrivateEquity baseCurrency={baseCurrency} />
      )}
      {sub === "crowdlending" && (
        <AlternativesCrowdlending baseCurrency={baseCurrency} />
      )}
      {sub === "tangibles" && (
        <AlternativesTangibles baseCurrency={baseCurrency} />
      )}
    </div>
  );
}

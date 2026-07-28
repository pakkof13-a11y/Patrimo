"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Gem,
  Handshake,
  LayoutDashboard,
  Palette,
  PieChart as PieChartIcon,
  Plus,
} from "lucide-react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  type AlternativesDashboardPayload,
  type AlternativesPortfolioSlice,
  type AlternativesSubTab,
} from "@/app/lib/alternatives/types";
import { CHART_COLORS } from "@/app/lib/types/ui";
import { AlternativesMetals } from "@/components/tabs/alternatives-metals";
import { AlternativesPrivateEquity } from "@/components/tabs/alternatives-private-equity";
import { AlternativesCrowdlending } from "@/components/tabs/alternatives-crowdlending";
import { AlternativesTangibles } from "@/components/tabs/alternatives-tangibles";
import { AltDashKpi } from "@/components/tabs/alternatives-shell";

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

const MODULE_GUIDES: Record<
  Exclude<AlternativesSubTab, "dashboard">,
  { title: string; blurb: string; cta: string }
> = {
  metals: {
    title: "Métaux précieux",
    blurb: "Or, argent, platine — physique ou papier, PRU et valorisation manuelle.",
    cta: "Ajouter un métal",
  },
  "private-equity": {
    title: "Private Equity",
    blurb: "Participations non cotées — NAV manuelle, P&L et MOIC.",
    cta: "Ajouter une position PE",
  },
  crowdlending: {
    title: "Crowdlending",
    blurb: "Prêts participatifs — capital, échéance et compte à rebours.",
    cta: "Ajouter un prêt",
  },
  tangibles: {
    title: "Tangibles & collection",
    blurb: "Montres, vins, art… — achat vs estimation manuelle.",
    cta: "Ajouter un objet",
  },
};

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

  // Sync depuis l'URL quand elle change ensuite — adjust state while rendering ;
  // sub reste par ailleurs togglable manuellement
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

  const summary = dashQ.data?.metals;
  const peSummary = dashQ.data?.privateEquity;
  const clSummary = dashQ.data?.crowdlending;
  const tangSummary = dashQ.data?.tangibles;
  const altAgg: AlternativesPortfolioSlice | undefined = dashQ.data?.summary;

  const pieData = useMemo(() => {
    const slices = (altAgg?.slices ?? []).filter((s) => s.value > 0);
    return slices.map((s, i) => ({
      ...s,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [altAgg]);

  const totalAlt = Number(altAgg?.totalEur ?? 0);
  const hasAnyAlt =
    (summary?.lineCount ?? 0) +
      (peSummary?.lineCount ?? 0) +
      (clSummary?.lineCount ?? 0) +
      (tangSummary?.lineCount ?? 0) >
    0;

  function goModule(id: AlternativesSubTab) {
    setSub(id);
  }

  return (
    <div className="space-y-5" data-testid="alternatives-tab">
      {/* ── Header section ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-snug">
            Actifs alternatifs
          </h1>
          <p className="module-intro max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Poche hors marchés cotés — métaux, private equity, crowdlending et
            tangibles. La vue d’ensemble synthétise ; chaque sous-module gère
            sa saisie experte.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-2 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Total poche alternative
          </div>
          <div className="text-xl font-semibold tabular-nums tracking-tight text-teal-700 dark:text-teal-300">
            {formatCurrency(String(totalAlt), baseCurrency)}
          </div>
        </div>
      </div>

      {/* ── Sub-nav ── */}
      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2"
        aria-label="Sous-modules actifs alternatifs"
      >
        {SUB_NAV.map((item) => {
          const active = sub === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`alt-sub-${item.id}`}
              onClick={() => setSub(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                active
                  ? "bg-teal-50 text-teal-900 ring-1 ring-teal-500/25 dark:bg-teal-950/60 dark:text-teal-100"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
              <span className="sm:hidden">{item.short}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Dashboard ── */}
      {sub === "dashboard" && (
        <section className="space-y-4" data-testid="alt-dashboard">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AltDashKpi
              label="Métaux précieux"
              value={formatCurrency(summary?.totalValue || "0", baseCurrency)}
              hint={
                (summary?.lineCount ?? 0) > 0
                  ? `${summary?.lineCount} pos. · P&L ${formatCurrency(summary?.totalPnl || "0", baseCurrency)}`
                  : "Lingots, pièces, papier — non renseigné"
              }
              tone={Number(summary?.totalPnl || 0)}
              onClick={() => goModule("metals")}
            />
            <AltDashKpi
              label="Private Equity (NAV)"
              value={formatCurrency(peSummary?.totalNav || "0", baseCurrency)}
              hint={
                (peSummary?.lineCount ?? 0) > 0
                  ? `${peSummary?.lineCount} pos. · MOIC moy. ${peSummary?.avgMoic ?? 0}×`
                  : "Participations non cotées — non renseigné"
              }
              tone={Number(peSummary?.totalPnl || 0)}
              onClick={() => goModule("private-equity")}
            />
            <AltDashKpi
              label="Crowdlending (en cours)"
              value={formatCurrency(
                clSummary?.activeCapital || "0",
                baseCurrency
              )}
              hint={
                (clSummary?.lineCount ?? 0) > 0
                  ? `${clSummary?.lineCount} prêt(s)`
                  : "Prêts participatifs — non renseigné"
              }
              onClick={() => goModule("crowdlending")}
            />
            <AltDashKpi
              label="Tangibles & collection"
              value={formatCurrency(
                tangSummary?.totalValue || "0",
                baseCurrency
              )}
              hint={
                (tangSummary?.lineCount ?? 0) > 0
                  ? `${tangSummary?.lineCount} objet(s) · P&L ${formatCurrency(tangSummary?.totalPnl || "0", baseCurrency)}`
                  : "Collection — non renseigné"
              }
              tone={Number(tangSummary?.totalPnl || 0)}
              onClick={() => goModule("tangibles")}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-hidden p-4">
              <h2 className="mb-0.5 text-sm font-semibold">
                Répartition de la poche
              </h2>
              <p className="mb-3 text-[11px] text-slate-400">
                Poids de chaque sous-catégorie dans les actifs alternatifs
              </p>
              {pieData.length === 0 ? (
                <div className="flex min-h-[14rem] flex-col items-center justify-center gap-2 px-2 py-6 text-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--muted)] text-slate-400">
                    <PieChartIcon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    La répartition apparaîtra ici
                  </p>
                  <p className="max-w-xs text-[11px] leading-relaxed text-slate-400">
                    Ajoutez une première position dans un sous-module pour
                    visualiser le poids de chaque poche.
                  </p>
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {pieData.map((e) => (
                          <Cell key={e.id} fill={e.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) =>
                          formatCurrency(String(v ?? 0), baseCurrency)
                        }
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-0.5 text-sm font-semibold">
                {hasAnyAlt ? "Détail par module" : "Démarrer la poche alternative"}
              </h2>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                {hasAnyAlt
                  ? "Total intégré au patrimoine net global. Cliquez une carte ou un module pour saisir."
                  : "Choisissez le type d’actif à suivre. Chaque module ouvre un formulaire à la demande — pas de saisie bloquante ici."}
              </p>

              {hasAnyAlt ? (
                <ul className="space-y-2 text-sm">
                  {pieData.map((s) => {
                    const pct =
                      totalAlt > 0
                        ? Math.round((s.value / totalAlt) * 1000) / 10
                        : 0;
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between border-t border-[var(--border)] pt-2"
                      >
                        <button
                          type="button"
                          className="text-left font-medium text-slate-700 hover:text-teal-700 dark:text-slate-200 dark:hover:text-teal-300"
                          onClick={() =>
                            goModule(
                              (s.id as AlternativesSubTab) || "dashboard"
                            )
                          }
                        >
                          {s.name}
                        </button>
                        <span className="tabular-nums font-medium">
                          {formatCurrency(String(s.value), baseCurrency)}
                          <span className="ml-2 text-xs text-slate-400">
                            {pct} %
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    Object.keys(MODULE_GUIDES) as Array<
                      keyof typeof MODULE_GUIDES
                    >
                  ).map((id) => {
                    const g = MODULE_GUIDES[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goModule(id)}
                        className={cn(
                          "rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 text-left transition",
                          "hover:border-teal-500/30 hover:bg-teal-500/[0.04]",
                          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                        )}
                      >
                        <div className="text-sm font-semibold">{g.title}</div>
                        <p className="mt-1 text-[11px] leading-snug text-slate-400">
                          {g.blurb}
                        </p>
                        <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 dark:text-teal-300">
                          <Plus className="h-3 w-3" />
                          {g.cta}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {hasAnyAlt && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("metals")}
                  >
                    Métaux
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("private-equity")}
                  >
                    Private Equity
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("crowdlending")}
                  >
                    Crowdlending
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("tangibles")}
                  >
                    Tangibles
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
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

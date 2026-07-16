"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import type { FiscalYearReport } from "@/app/lib/tax/fiscal-year";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

function moneyClass(n: number): string {
  if (n > 0) return "text-emerald-600 dark:text-emerald-400";
  if (n < 0) return "text-rose-600 dark:text-rose-400";
  return "text-slate-500";
}

export function FiscalYearTab({ baseCurrency = "EUR" }: { baseCurrency?: string }) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 6 }, (_, i) => currentYear - i),
    [currentYear]
  );
  const [year, setYear] = useState(currentYear);

  const q = useQuery({
    queryKey: ["fiscal-year", year],
    queryFn: () =>
      fetchJson<FiscalYearReport>(
        `/api/tax/fiscal-year?year=${encodeURIComponent(String(year))}`
      ),
    staleTime: 60_000,
  });

  const report = q.data;

  return (
    <section className="space-y-4" data-testid="fiscal-year-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            Année fiscale
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
            Plus-values réalisées et revenus par enveloppe (année civile
            Europe/Paris). Estimations — pas un avis d&apos;imposition.
          </p>
        </div>
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
          Année
          <select
            className="input !w-auto !py-1.5 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            data-testid="fiscal-year-select"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading && !report && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {q.isError && (
        <p className="text-sm text-rose-600">
          Impossible de charger le rapport fiscal.
        </p>
      )}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Réalisé (ventes)"
              value={report.totals.realizedPnlEur}
              currency={baseCurrency}
            />
            <KpiCard
              label="Dividendes nets"
              value={report.totals.dividendsNetEur}
              currency={baseCurrency}
            />
            <KpiCard
              label="WHT (source)"
              value={report.totals.withholdingTaxEur}
              currency={baseCurrency}
            />
            <KpiCard
              label="PFU 30 % estimé*"
              value={report.totals.estimatedPfuEur}
              currency={baseCurrency}
              hint="Sur CTO / crypto / CFD uniquement"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-sm" data-testid="fiscal-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/60">
                <tr>
                  <th className="px-3 py-2 font-medium">Enveloppe</th>
                  <th className="px-3 py-2 font-medium tabular-nums">Réalisé</th>
                  <th className="px-3 py-2 font-medium tabular-nums">Div. nets</th>
                  <th className="px-3 py-2 font-medium tabular-nums">WHT</th>
                  <th className="px-3 py-2 font-medium tabular-nums">Ventes</th>
                  <th className="px-3 py-2 font-medium tabular-nums">Revenus</th>
                </tr>
              </thead>
              <tbody>
                {report.byEnvelope.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Aucune vente ni revenu en {report.year}
                    </td>
                  </tr>
                ) : (
                  report.byEnvelope.map((b) => (
                    <tr
                      key={b.accountType}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-3 py-2 font-medium">{b.label}</td>
                      <td
                        className={cn(
                          "px-3 py-2 tabular-nums",
                          moneyClass(b.realizedPnlEur)
                        )}
                      >
                        {formatCurrency(b.realizedPnlEur, baseCurrency)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-200">
                        {formatCurrency(b.dividendsNetEur, baseCurrency)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">
                        {formatCurrency(b.withholdingTaxEur, baseCurrency)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">
                        {b.sellCount}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">
                        {b.incomeCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[11px] leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            {report.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}

function KpiCard({
  label,
  value,
  currency,
  hint,
}: {
  label: string;
  value: number;
  currency: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-lg font-bold tabular-nums",
          moneyClass(value)
        )}
      >
        {formatCurrency(value, currency)}
      </div>
      {hint && (
        <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>
      )}
    </div>
  );
}

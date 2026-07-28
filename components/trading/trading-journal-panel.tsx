"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency } from "@/app/lib/utils";
import { LOSS_CARRY_FORWARD_YEARS } from "@/app/lib/trading/tax";
import type { TradingBundle } from "./types";

/** Tranches du barème progressif de l'impôt sur le revenu. */
const TMI_OPTIONS = ["", "0", "11", "30", "41", "45"] as const;

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone != null &&
            (tone < 0 ? "text-[var(--danger)]" : "text-[var(--success)]")
        )}
      >
        {value}
      </p>
      {hint && <p className="text-meta mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * Journal de trading — performance des opérations closes et situation fiscale.
 *
 * Les deux vivent sur le même écran parce qu'ils répondent à la même question
 * dans deux temporalités : ce que la stratégie rapporte, et ce qu'il en restera
 * après impôt.
 */
export function TradingJournalPanel({ className }: { className?: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tmi, setTmi] = useState<string>("");

  const q = useQuery({
    queryKey: ["trading", year, tmi],
    queryFn: () =>
      fetchJson<TradingBundle>(
        `/api/trading?year=${year}${tmi ? `&tmi=${tmi}` : ""}`
      ),
  });

  const closed = useMemo(
    () => (q.data?.positions ?? []).filter((p) => !p.isOpen),
    [q.data]
  );

  if (q.isPending) return <Skeleton className={cn("h-64 w-full", className)} />;

  const a = q.data!.analytics;
  const f = q.data!.fiscal;
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <section
      className={cn("card p-4", className)}
      data-testid="trading-journal-panel"
    >
      <PanelHeader
        title="Journal de trading"
        subtitle="Opérations closes, performance de la stratégie et imposition de l'exercice"
      />

      {a.tradeCount === 0 ? (
        <EmptyPlaceholder
          compact
          title="Aucune opération close"
          description="Les statistiques et l'assiette fiscale se calculent sur les positions clôturées : une position ouverte n'a pas encore de résultat."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi
              label="Opérations"
              value={String(a.tradeCount)}
              hint={`${a.winCount} gagnantes · ${a.lossCount} perdantes`}
            />
            <Kpi
              label="Taux de réussite"
              value={a.winRatePct ? `${a.winRatePct} %` : "—"}
            />
            <Kpi
              label="Résultat net"
              value={formatCurrency(a.netPnlEur, "EUR")}
              tone={Number(a.netPnlEur)}
            />
            <Kpi
              label="Ratio gain/perte"
              value={a.riskRewardRatio ?? "—"}
              hint={a.riskRewardRatio ? "gain moyen ÷ perte moyenne" : "aucune perte"}
            />
            <Kpi
              label="Profit factor"
              value={a.profitFactor ?? "—"}
              hint={a.profitFactor ? "au-dessus de 1 : gagnant" : "aucune perte"}
            />
            <Kpi
              label="Drawdown max"
              value={formatCurrency(a.maxDrawdownEur, "EUR")}
              hint="plus forte baisse depuis un sommet"
            />
          </div>

          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h3 className="text-sm font-semibold">Imposition de l&apos;exercice</h3>
              <div className="flex gap-2">
                <label className="text-meta block">
                  Année
                  <select
                    className="input mt-1 h-8 py-0 text-xs"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    data-testid="trading-fiscal-year"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-meta block">
                  Tranche marginale
                  <select
                    className="input mt-1 h-8 py-0 text-xs"
                    value={tmi}
                    onChange={(e) => setTmi(e.target.value)}
                    data-testid="trading-fiscal-tmi"
                  >
                    {TMI_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t === "" ? "— non renseignée —" : `${t} %`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-3 space-y-1 text-xs">
              <Line label="Gains bruts" value={f.grossGainsEur} />
              <Line label="Pertes brutes" value={`-${f.grossLossesEur}`} />
              <Line label="Frais et commissions" value={`-${f.feesEur}`} />
              <Line
                label="Résultat avant report"
                value={f.netBeforeCarryEur}
                strong
              />
              {Number(f.carryUsedEur) > 0 && (
                <Line
                  label="Moins-values antérieures imputées"
                  value={`-${f.carryUsedEur}`}
                />
              )}
              <Line label="Assiette imposable" value={f.taxableEur} strong />
            </div>

            {Number(f.carryForwardEur) > 0 && (
              <p
                className="text-meta mt-2 rounded-[var(--radius-md)] bg-[var(--muted)]/30 px-2 py-1.5"
                data-testid="trading-carry-forward"
              >
                <strong>{formatCurrency(f.carryForwardEur, "EUR")}</strong> de
                moins-values encore reportables, sur{" "}
                {LOSS_CARRY_FORWARD_YEARS} ans. Elles ne s&apos;imputent que sur
                des gains de même nature — jamais sur votre revenu global ni sur
                des plus-values d&apos;actions.
              </p>
            )}

            {Number(f.expiredEur) > 0 && (
              <p className="mt-2 text-[11px] text-[var(--danger)]">
                {formatCurrency(f.expiredEur, "EUR")} de moins-values périmées
                faute d&apos;avoir été imputées dans le délai.
              </p>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div
                className={cn(
                  "rounded-[var(--radius-md)] border p-2.5",
                  f.cheaper === "PFU"
                    ? "border-[var(--success)]/40 bg-[var(--success)]/5"
                    : "border-[var(--border)]"
                )}
                data-testid="trading-pfu"
              >
                <p className="text-[11px] font-medium">
                  Prélèvement forfaitaire unique
                </p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {formatCurrency(f.pfu.totalEur, "EUR")}
                </p>
                <p className="text-meta">
                  {f.pfu.effectiveRatePct} % · dont{" "}
                  {formatCurrency(f.pfu.socialChargesEur, "EUR")} de
                  prélèvements sociaux
                </p>
              </div>

              <div
                className={cn(
                  "rounded-[var(--radius-md)] border p-2.5",
                  f.cheaper === "BAREME"
                    ? "border-[var(--success)]/40 bg-[var(--success)]/5"
                    : "border-[var(--border)]"
                )}
                data-testid="trading-bareme"
              >
                <p className="text-[11px] font-medium">Barème progressif</p>
                {f.bareme ? (
                  <>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {formatCurrency(f.bareme.totalEur, "EUR")}
                    </p>
                    <p className="text-meta">
                      {f.bareme.effectiveRatePct} % · tranche{" "}
                      {f.bareme.marginalRatePct} %
                    </p>
                  </>
                ) : (
                  <p className="text-meta mt-0.5">
                    Renseignez votre tranche marginale pour comparer.
                  </p>
                )}
              </div>
            </div>

            <p className="text-meta mt-2 flex items-start gap-1.5">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>
                Estimation indicative. L&apos;option pour le barème est{" "}
                <strong>globale</strong> : elle engage tous vos revenus du
                capital de l&apos;année, pas seulement ces gains. Le comparatif
                ci-dessus n&apos;en tient pas compte.
              </span>
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs" data-testid="trading-journal-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="py-1.5 pr-2">Instrument</th>
                  <th className="py-1.5 pr-2">Sens</th>
                  <th className="py-1.5 pr-2">Clôturée</th>
                  <th className="py-1.5 pr-2 text-right">Durée</th>
                  <th className="py-1.5 text-right">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => {
                  const pnl = Number(p.realizedPnl ?? 0);
                  const days =
                    p.openedAt && p.closedAt
                      ? Math.round(
                          (new Date(p.closedAt).getTime() -
                            new Date(p.openedAt).getTime()) /
                            86_400_000
                        )
                      : null;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--border)]/50"
                      data-testid="trading-journal-row"
                    >
                      <td className="py-1.5 pr-2 font-medium">{p.instrument}</td>
                      <td className="py-1.5 pr-2">{p.direction}</td>
                      <td className="py-1.5 pr-2">
                        {p.closedAt
                          ? new Date(p.closedAt).toLocaleDateString("fr-FR")
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {days != null ? `${days} j` : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 text-right font-medium tabular-nums",
                          pnl < 0
                            ? "text-[var(--danger)]"
                            : "text-[var(--success)]"
                        )}
                      >
                        {formatCurrency(String(pnl), "EUR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between",
        strong && "border-t border-[var(--border)] pt-1 font-medium"
      )}
    >
      <span className={cn(!strong && "text-[var(--muted-foreground)]")}>
        {label}
      </span>
      <span className="tabular-nums">{formatCurrency(value, "EUR")}</span>
    </div>
  );
}

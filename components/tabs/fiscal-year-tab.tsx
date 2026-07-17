"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Shield } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import type {
  FiscalEnvelopeBucket,
  FiscalYearReport,
} from "@/app/lib/tax/fiscal-year";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import {
  ModuleCallout,
  ModuleCard,
  ModuleCardHeader,
  ModuleKpi,
  ModulePageHeader,
  moduleTableHeadClass,
  moduleTableRowClass,
} from "@/components/ui/module-shell";
import { EmptyPlaceholder } from "@/components/ui/panel";

function moneyClass(n: number): string {
  if (n > 0) return "text-[var(--success)]";
  if (n < 0) return "text-[var(--danger)]";
  return "text-[var(--muted-foreground)]";
}

/** Enveloppes incluses dans l’estimation PFU simplifiée. */
const PFU_ENVELOPES = new Set(["CTO", "CRYPTO", "CFD"]);

/** Régimes fiscaux spéciaux — hors PFU auto. */
const SPECIAL_ENVELOPES = new Set(["PEA", "AV"]);

function envelopeKind(
  accountType: string
): "pfu" | "special" | "other" {
  const k = accountType.toUpperCase();
  if (PFU_ENVELOPES.has(k)) return "pfu";
  if (SPECIAL_ENVELOPES.has(k)) return "special";
  return "other";
}

function EnvelopeBadge({ accountType }: { accountType: string }) {
  const kind = envelopeKind(accountType);
  if (kind === "pfu") {
    return (
      <span className="inline-flex rounded-md bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-800 ring-1 ring-inset ring-sky-200/80 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800/50">
        PFU indicatif
      </span>
    );
  }
  if (kind === "special") {
    return (
      <span className="inline-flex rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-800 ring-1 ring-inset ring-violet-200/80 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800/50">
        Régime spécial
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
      Suivi
    </span>
  );
}

export function FiscalYearTab({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 6 }, (_, i) => currentYear - i),
    [currentYear]
  );
  const [year, setYear] = useState(currentYear);
  const [showHow, setShowHow] = useState(false);

  const q = useQuery({
    queryKey: ["fiscal-year", year],
    queryFn: () =>
      fetchJson<FiscalYearReport>(
        `/api/tax/fiscal-year?year=${encodeURIComponent(String(year))}`
      ),
    staleTime: 60_000,
  });

  const report = q.data;

  const pfuBaseFromReport = useMemo(() => {
    if (!report) return 0;
    // Reverse of 30 % for display of base (gains positifs CTO/crypto/CFD)
    return report.totals.estimatedPfuEur / 0.3;
  }, [report]);

  return (
    <section className="section-stack" data-testid="fiscal-year-tab">
      <ModulePageHeader
        title="Fiscalité"
        subtitle={
          <>
            Synthèse de suivi pour l’année civile (Europe/Paris) : plus-values
            réalisées, revenus nets et retenue à la source, par enveloppe.{" "}
            <strong className="font-medium text-[var(--foreground)]/80">
              Indicateurs de pilotage — pas un avis d’imposition
            </strong>
            .
          </>
        }
        actions={
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
            Année civile
            <select
              className="input !w-auto min-w-[5.5rem] !py-1.5 text-sm font-semibold tabular-nums"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              data-testid="fiscal-year-select"
              aria-label="Année fiscale"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {q.isLoading && !report && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {q.isError && (
        <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
          Impossible de charger le rapport fiscal. Réessayez dans un instant.
        </div>
      )}

      {report && (
        <>
          <div>
            <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
              <h3 className="text-title">Synthèse {report.year}</h3>
              <button
                type="button"
                className="text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                onClick={() => setShowHow((v) => !v)}
                aria-expanded={showHow}
              >
                {showHow ? "Masquer le mode d’emploi" : "Comment lire ces chiffres"}
              </button>
            </div>

            {showHow && (
              <ModuleCallout tone="info" className="mb-3">
                <p>
                  <strong>Réalisé</strong> — gains ou pertes sur les{" "}
                  <em>ventes</em> de l’année (prix − CUMP), par lot multi-plateforme.
                </p>
                <p className="mt-1.5">
                  <strong>Dividendes nets</strong> — revenus encaissés après WHT
                  et frais (dividendes, coupons, loyers, intérêts).
                </p>
                <p className="mt-1.5">
                  <strong>WHT</strong> — retenue à la source étrangère déjà
                  prélevée ; un crédit d’impôt éventuel n’est pas calculé ici.
                </p>
                <p className="mt-1.5">
                  <strong>PFU estimé</strong> — ordre de grandeur à 30 % sur les
                  gains <em>positifs</em> des seules enveloppes CTO, crypto et
                  CFD. PEA et assurance-vie sont exclus.
                </p>
              </ModuleCallout>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ModuleKpi
                label={
                  <span className="inline-flex items-center gap-1">
                    Plus-value réalisée
                    <FinanceTip term="P&L réalisé fiscal" />
                  </span>
                }
                value={formatCurrency(report.totals.realizedPnlEur, baseCurrency)}
                valueClassName={moneyClass(report.totals.realizedPnlEur)}
                hint="Ventes de l’année (toutes enveloppes)"
              />
              <ModuleKpi
                label={
                  <span className="inline-flex items-center gap-1">
                    Dividendes nets
                    <FinanceTip term="Dividendes nets" />
                  </span>
                }
                value={formatCurrency(report.totals.dividendsNetEur, baseCurrency)}
                hint="Revenus nets de WHT / frais"
              />
              <ModuleKpi
                label={
                  <span className="inline-flex items-center gap-1">
                    Retenue à la source
                    <FinanceTip term="WHT fiscal" />
                  </span>
                }
                value={formatCurrency(
                  report.totals.withholdingTaxEur,
                  baseCurrency
                )}
                valueClassName="text-[var(--muted-foreground)]"
                hint="WHT étrangère (hors crédit d’impôt)"
              />
              <ModuleKpi
                label={
                  <span className="inline-flex items-center gap-1">
                    PFU estimé (~30 %)
                    <FinanceTip term="PFU estimé" />
                  </span>
                }
                value={formatCurrency(
                  report.totals.estimatedPfuEur,
                  baseCurrency
                )}
                hint="CTO · crypto · CFD seulement"
                className="border-sky-500/30 bg-sky-500/[0.04]"
              />
            </div>
          </div>

          <ModuleCallout tone="info" testId="fiscal-pfu-scope">
            <div className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" />
              <div className="min-w-0 space-y-1.5">
                <p className="font-semibold text-[var(--foreground)]">
                  Portée du PFU estimé — ce n’est pas une simulation d’impôt
                  complète
                </p>
                <p>
                  Base indicative : gains{" "}
                  <strong>positifs</strong> (plus-values + dividendes nets) sur{" "}
                  <strong>Compte-Titres, crypto et CFD</strong> uniquement.
                  {pfuBaseFromReport > 0 && (
                    <>
                      {" "}
                      Base ≈{" "}
                      <span className="tabular-nums font-medium">
                        {formatCurrency(pfuBaseFromReport, baseCurrency)}
                      </span>
                      {" × 30 % = "}
                      <span className="tabular-nums font-medium">
                        {formatCurrency(
                          report.totals.estimatedPfuEur,
                          baseCurrency
                        )}
                      </span>
                      .
                    </>
                  )}
                </p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  <li className="flex gap-1.5">
                    <span className="text-[var(--success)]">✓</span>
                    Inclus : CTO, crypto, CFD (gains &gt; 0)
                  </li>
                  <li className="flex gap-1.5">
                    <span className="text-[var(--muted-foreground)]">✗</span>
                    Exclus : PEA, assurance-vie, pertes nettes
                  </li>
                  <li className="flex gap-1.5">
                    <span className="text-[var(--muted-foreground)]">✗</span>
                    Non traité : abattements, options barème, IFI…
                  </li>
                  <li className="flex gap-1.5">
                    <span className="text-[var(--muted-foreground)]">✗</span>
                    Non traité : crédit d’impôt WHT, prélèvements sociaux AV
                  </li>
                </ul>
              </div>
            </div>
          </ModuleCallout>

          <ModuleCard>
            <ModuleCardHeader
              title="Détail par enveloppe"
              subtitle="Même année que les KPI. Les pastilles indiquent si l’enveloppe entre dans l’estimation PFU."
            />

            <div className="table-container-responsive table-fluid-wrap">
              <table
                className="table-fluid text-sm"
                data-testid="fiscal-table"
              >
                <thead className={moduleTableHeadClass}>
                  <tr>
                    <th className="px-3 py-2.5 text-left">Enveloppe</th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-0.5">
                        Réalisé
                        <FinanceTip term="P&L réalisé fiscal" />
                      </span>
                    </th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-0.5">
                        Div. nets
                        <FinanceTip term="Dividendes nets" />
                      </span>
                    </th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-0.5">
                        WHT
                        <FinanceTip term="WHT fiscal" />
                      </span>
                    </th>
                    <th className="px-3 py-2.5 text-right">Ventes</th>
                    <th className="px-3 py-2.5 text-right">Revenus</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byEnvelope.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-4">
                        <EmptyPlaceholder
                          title={`Aucune vente ni revenu en ${report.year}`}
                          description="Les opérations du journal (ventes, dividendes, coupons…) alimenteront cette synthèse pour l’année sélectionnée."
                        />
                      </td>
                    </tr>
                  ) : (
                    report.byEnvelope.map((b) => (
                      <EnvelopeRow
                        key={b.accountType}
                        bucket={b}
                        currency={baseCurrency}
                      />
                    ))
                  )}
                </tbody>
                {report.byEnvelope.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)]/25 text-sm font-semibold">
                      <td className="px-3 py-2.5">Total</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right tabular-nums",
                          moneyClass(report.totals.realizedPnlEur)
                        )}
                      >
                        {formatCurrency(
                          report.totals.realizedPnlEur,
                          baseCurrency
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatCurrency(
                          report.totals.dividendsNetEur,
                          baseCurrency
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted-foreground)]">
                        {formatCurrency(
                          report.totals.withholdingTaxEur,
                          baseCurrency
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted-foreground)]">
                        {report.byEnvelope.reduce(
                          (s, b) => s + b.sellCount,
                          0
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted-foreground)]">
                        {report.byEnvelope.reduce(
                          (s, b) => s + b.incomeCount,
                          0
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {report.byEnvelope.some(
              (b) => envelopeKind(b.accountType) === "special"
            ) && (
              <p className="text-meta border-t border-[var(--border)] px-4 py-2 text-[10px] leading-snug">
                <FinanceTip term="PEA" />{" "}
                <FinanceTip term="Assurance-vie" /> Les enveloppes « régime
                spécial » affichent le réalisé et les revenus pour le suivi,
                sans entrer dans le PFU estimé ci-dessus.
              </p>
            )}
          </ModuleCard>

          <ModuleCallout tone="warn" testId="fiscal-disclaimer">
            <div className="flex gap-2.5">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="space-y-2">
                <p className="font-semibold">Cadre d’interprétation</p>
                <p>{report.disclaimer}</p>
                <ul className="list-inside list-disc space-y-1 opacity-90">
                  <li>
                    Les montants proviennent de vos transactions Patrimo
                    (année civile Europe/Paris).
                  </li>
                  <li>
                    Ils ne remplacent pas les IFU, relevés bancaires ni une
                    déclaration complète.
                  </li>
                  <li>
                    En cas de doute, un conseiller fiscal ou expert-comptable
                    reste la référence.
                  </li>
                </ul>
              </div>
            </div>
          </ModuleCallout>
        </>
      )}
    </section>
  );
}

function EnvelopeRow({
  bucket: b,
  currency,
}: {
  bucket: FiscalEnvelopeBucket;
  currency: string;
}) {
  const kind = envelopeKind(b.accountType);
  return (
    <tr
      className={cn(
        moduleTableRowClass,
        kind === "special" && "bg-violet-500/[0.03]",
        kind === "pfu" && "bg-sky-500/[0.02]"
      )}
    >
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-[var(--foreground)]">{b.label}</span>
          <EnvelopeBadge accountType={b.accountType} />
        </div>
      </td>
      <td
        className={cn(
          "px-3 py-2.5 text-right tabular-nums font-medium",
          moneyClass(b.realizedPnlEur)
        )}
      >
        {formatCurrency(b.realizedPnlEur, currency)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--foreground)]">
        {formatCurrency(b.dividendsNetEur, currency)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted-foreground)]">
        {formatCurrency(b.withholdingTaxEur, currency)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted-foreground)]">
        {b.sellCount}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted-foreground)]">
        {b.incomeCount}
      </td>
    </tr>
  );
}



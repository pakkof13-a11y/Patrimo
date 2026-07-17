"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  HelpCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BANK_OPTIONS } from "@/app/lib/constants";
import {
  ACCOUNT_CURRENCY_OPTIONS,
  currencyLabel,
} from "@/app/lib/money/currencies";
import { formatCurrency, cn } from "@/app/lib/utils";
import { toast } from "sonner";

/* ─── Shared atoms ─────────────────────────────────────────────────── */

function CurrencySelect({
  value,
  onChange,
  className,
  title,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  title?: string;
}) {
  const codes = ACCOUNT_CURRENCY_OPTIONS as readonly string[];
  const options = codes.includes(value) ? codes : [value, ...codes];
  return (
    <select
      className={cn("input !py-1.5", className)}
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((c) => (
        <option key={c} value={c}>
          {currencyLabel(c)}
        </option>
      ))}
    </select>
  );
}

/** Combobox banque avec recherche (liste longue). */
function BankNameCombobox({
  value,
  onChange,
  className,
  testId,
}: {
  value: string;
  onChange: (name: string) => void;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...BANK_OPTIONS];
    if (!q) return list;
    return list.filter((b) => b.toLowerCase().includes(q));
  }, [query]);

  const listboxId = `${testId || "bank-combobox"}-listbox`;

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden
        />
        <input
          role="combobox"
          className="input w-full !py-1.5 !pl-8 !pr-8 text-sm"
          value={query}
          data-testid={testId}
          placeholder="Rechercher une banque…"
          aria-label="Banque"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            // Commit free text if valid / custom
            if (query.trim() && query.trim() !== value) {
              onChange(query.trim());
            }
          }}
        />
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden
        />
      </div>
      {open && (
        <ul
          id={listboxId}
          className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
              Aucune banque — appuyez hors liste pour garder « {query.trim()} »
            </li>
          ) : (
            filtered.map((b) => (
              <li key={b}>
                <button
                  type="button"
                  role="option"
                  aria-selected={b === value}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--muted)]",
                    b === value && "bg-teal-700/10 font-medium text-teal-900 dark:text-teal-100"
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(b);
                    setQuery(b);
                    setOpen(false);
                  }}
                >
                  {b}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function NetWorthBadge({
  included,
  compact,
}: {
  included: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        included
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      )}
      title={
        included
          ? "Solde > 0 : ce compte entre dans le patrimoine net"
          : "Solde à 0 : ignoré du patrimoine net (évite le bruit)"
      }
    >
      {included ? "Dans le patrimoine" : "Hors patrimoine (0)"}
      {!compact && (
        <HelpCircle className="h-2.5 w-2.5 opacity-60" aria-hidden />
      )}
    </span>
  );
}

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
      {children}
      {hint && (
        <span title={hint} className="cursor-help text-slate-400">
          <HelpCircle className="h-3 w-3" />
        </span>
      )}
    </span>
  );
}

const DOW_LABELS = [
  "",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];
const MONTH_LABELS = [
  "",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/* ─── Main tab ─────────────────────────────────────────────────────── */

export function BanksTab({ baseCurrency }: { baseCurrency: string }) {
  const qc = useQueryClient();
  const banksQ = useQuery({
    queryKey: ["banks"],
    queryFn: () =>
      fetchJson<{
        accounts: Array<{
          id: string;
          bankName: string;
          balance: string;
          currency: string;
          countsInNetWorth: boolean;
        }>;
      }>("/api/banks"),
  });
  const savingsQ = useQuery({
    queryKey: ["savings"],
    queryFn: () =>
      fetchJson<{
        accounts: Array<{
          id: string;
          name: string;
          balance: string;
          displayBalance: string;
          apyPercent: string;
          rateType: string;
          payoutFrequency: string;
          payoutDayOfWeek: number | null;
          payoutDayOfMonth: number | null;
          payoutMonth: number | null;
          payoutRuleLabel: string;
          dailyInterest: string;
          periodInterest: string;
          daysElapsed: number;
          currency: string;
          countsInNetWorth: boolean;
          lastPayoutAt: string | null;
        }>;
      }>("/api/savings"),
    refetchInterval: 60_000,
  });

  const [bankName, setBankName] = useState("Revolut");
  const [bankBalance, setBankBalance] = useState("0");
  const [bankCurrency, setBankCurrency] = useState("EUR");

  const [livretName, setLivretName] = useState("Livret A");
  const [livretBalance, setLivretBalance] = useState("0");
  const [livretApy, setLivretApy] = useState("3");
  const [livretRateType, setLivretRateType] = useState<"APR" | "APY">("APY");
  const [livretFreq, setLivretFreq] = useState<
    "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  >("DAILY");
  const [livretDow, setLivretDow] = useState(1);
  const [livretDom, setLivretDom] = useState(1);
  const [livretMonth, setLivretMonth] = useState(12);
  const [livretCurrency, setLivretCurrency] = useState("EUR");
  const [livretAdvanced, setLivretAdvanced] = useState(false);
  const [expandedSavings, setExpandedSavings] = useState<Record<string, boolean>>(
    {}
  );

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["banks"] });
    await qc.invalidateQueries({ queryKey: ["savings"] });
    await qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const addBank = useMutation({
    mutationFn: () =>
      fetchJson("/api/banks", {
        method: "POST",
        body: JSON.stringify({
          bankName,
          balance: bankBalance || "0",
          currency: bankCurrency || "EUR",
        }),
      }),
    onSuccess: async () => {
      toast.success("Compte courant ajouté");
      setBankBalance("0");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSavings = useMutation({
    mutationFn: () =>
      fetchJson("/api/savings", {
        method: "POST",
        body: JSON.stringify({
          name: livretName,
          balance: livretBalance || "0",
          apyPercent: livretApy || "0",
          rateType: livretRateType,
          payoutFrequency: livretFreq,
          payoutDayOfWeek: livretFreq === "WEEKLY" ? livretDow : null,
          payoutDayOfMonth:
            livretFreq === "MONTHLY" || livretFreq === "YEARLY"
              ? livretDom
              : null,
          payoutMonth: livretFreq === "YEARLY" ? livretMonth : null,
          currency: livretCurrency || "EUR",
        }),
      }),
    onSuccess: async () => {
      toast.success("Livret ajouté");
      setLivretBalance("0");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accrueMut = useMutation({
    mutationFn: () =>
      fetchJson<{ periodsCredited?: number }>("/api/savings/accrue", {
        method: "POST",
      }),
    onSuccess: async (data) => {
      toast.success(
        data.periodsCredited
          ? `Intérêts crédités : ${data.periodsCredited} période(s)`
          : "Aucun versement dû pour le moment"
      );
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchBank = useMutation({
    mutationFn: (body: Record<string, string>) =>
      fetchJson("/api/banks", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const patchSavings = useMutation({
    mutationFn: (body: Record<string, string>) =>
      fetchJson("/api/savings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const banks = banksQ.data?.accounts ?? [];
  const savings = savingsQ.data?.accounts ?? [];

  return (
    <div className="section-stack space-y-6" data-testid="banks-tab">
      <header className="px-0.5">
        <h1 className="text-title">Banques</h1>
        <p className="text-meta mt-0.5">
          Comptes courants et livrets · conversion en {baseCurrency} pour le
          patrimoine agrégé uniquement
        </p>
      </header>

      {/* ═══════════════ Comptes courants ═══════════════ */}
      <section className="space-y-3" data-testid="banks-checking-section">
        <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
              Comptes courants
            </h2>
            <p className="text-meta">
              Liquidités à vue · inclus dans le patrimoine si solde &gt; 0
            </p>
          </div>
        </div>

        {/* Carte d’ajout rapide — séparée de la liste */}
        <div className="card p-3.5 sm:p-4" data-testid="banks-checking-add">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Ajouter un compte
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="min-w-0 flex-1 sm:min-w-[12rem] sm:max-w-xs">
              <FieldLabel>Banque</FieldLabel>
              <BankNameCombobox
                value={bankName}
                onChange={setBankName}
                testId="banks-add-bank-name"
              />
            </label>
            <label className="w-full sm:w-32">
              <FieldLabel hint="Montant dans la devise du compte (pas de conversion auto)">
                Solde
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={bankBalance}
                onChange={(e) => setBankBalance(e.target.value)}
                inputMode="decimal"
                data-testid="banks-add-balance"
              />
            </label>
            <label className="w-full sm:w-32">
              <FieldLabel hint="Devise nominale du compte — le solde n’est pas converti">
                Devise
              </FieldLabel>
              <CurrencySelect
                value={bankCurrency}
                onChange={setBankCurrency}
                className="w-full"
                title="Devise du compte courant"
              />
            </label>
            <Button
              size="sm"
              className="h-9 shrink-0"
              onClick={() => addBank.mutate()}
              disabled={addBank.isPending}
              data-testid="banks-add-submit"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>
        </div>

        {/* Liste existante */}
        <div className="card overflow-hidden" data-testid="banks-checking-list">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <p className="text-[11px] font-medium text-[var(--muted-foreground)]">
              Comptes enregistrés
              {!banksQ.isLoading && (
                <span className="ml-1.5 tabular-nums">
                  · {banks.length}
                </span>
              )}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Banque</th>
                  <th className="px-4 py-2.5 text-right font-medium">Solde</th>
                  <th className="px-4 py-2.5 text-left font-medium">Devise</th>
                  <th className="px-4 py-2.5 text-center font-medium">
                    Patrimoine
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {banks.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--muted)]/20"
                  >
                    <td className="px-4 py-2.5">
                      <BankNameCombobox
                        value={a.bankName}
                        onChange={(bankName) =>
                          patchBank.mutate({ id: a.id, bankName })
                        }
                        className="min-w-[10rem]"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        className="input ml-auto !w-32 !py-1.5 text-right tabular-nums"
                        defaultValue={a.balance}
                        key={`${a.id}-bal-${a.balance}`}
                        onBlur={(e) => {
                          if (e.target.value !== a.balance) {
                            patchBank.mutate({
                              id: a.id,
                              balance: e.target.value,
                            });
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <CurrencySelect
                        value={a.currency || "EUR"}
                        className="!w-28"
                        title="Devise de ce compte (solde non converti)"
                        onChange={(currency) => {
                          if (currency !== a.currency) {
                            patchBank.mutate({ id: a.id, currency });
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <NetWorthBadge included={a.countsInNetWorth} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        title="Supprimer"
                        aria-label="Supprimer le compte"
                        onClick={() =>
                          fetchJson(`/api/banks?id=${a.id}`, {
                            method: "DELETE",
                          }).then(refresh)
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {banks.length === 0 && !banksQ.isLoading && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]"
                    >
                      Aucun compte courant — utilisez le formulaire ci-dessus
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══════════════ Livrets ═══════════════ */}
      <section className="space-y-3" data-testid="banks-savings-section">
        <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
              Livrets d&apos;épargne
            </h2>
            <p className="text-meta">
              Intérêts capitalisés selon la périodicité choisie
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => accrueMut.mutate()}
            disabled={accrueMut.isPending || savings.length === 0}
            title="Crédite au solde les périodes d’intérêts déjà échues (selon chaque règle de livret)"
            data-testid="banks-accrue-interests"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                accrueMut.isPending && "animate-spin"
              )}
            />
            Actualiser les intérêts
          </Button>
        </div>

        {/* Ajout livret — essentiel + avancé repliable */}
        <div className="card p-3.5 sm:p-4" data-testid="banks-savings-add">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Ajouter un livret
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="w-full sm:min-w-[9rem] sm:flex-1 sm:max-w-[12rem]">
              <FieldLabel>Nom</FieldLabel>
              <input
                className="input w-full !py-1.5"
                value={livretName}
                onChange={(e) => setLivretName(e.target.value)}
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel>Solde</FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={livretBalance}
                onChange={(e) => setLivretBalance(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label className="w-full sm:w-24">
              <FieldLabel
                hint="APY = rendement annualisé effectif · APR = taux nominal annualisé"
              >
                Taux %
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={livretApy}
                onChange={(e) => setLivretApy(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel hint="Devise nominale du livret">Devise</FieldLabel>
              <CurrencySelect
                value={livretCurrency}
                onChange={setLivretCurrency}
                className="w-full"
              />
            </label>
            <Button
              size="sm"
              className="h-9 shrink-0"
              onClick={() => addSavings.mutate()}
              disabled={addSavings.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>

          <button
            type="button"
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            )}
            aria-expanded={livretAdvanced}
            onClick={() => setLivretAdvanced((v) => !v)}
            data-testid="banks-savings-advanced-toggle"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                livretAdvanced && "rotate-180"
              )}
            />
            Réglages du taux et des versements
          </button>

          {livretAdvanced && (
            <div
              className="mt-2.5 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3"
              data-testid="banks-savings-advanced"
            >
              <label className="w-full sm:w-24">
                <FieldLabel hint="APY : taux effectif · APR : taux nominal divisé par le nombre de périodes">
                  Type
                </FieldLabel>
                <select
                  className="input w-full !py-1.5"
                  value={livretRateType}
                  onChange={(e) =>
                    setLivretRateType(e.target.value as "APR" | "APY")
                  }
                >
                  <option value="APY">APY</option>
                  <option value="APR">APR</option>
                </select>
              </label>
              <label className="w-full sm:w-36">
                <FieldLabel>Périodicité</FieldLabel>
                <select
                  className="input w-full !py-1.5"
                  value={livretFreq}
                  onChange={(e) =>
                    setLivretFreq(
                      e.target.value as
                        | "DAILY"
                        | "WEEKLY"
                        | "MONTHLY"
                        | "YEARLY"
                    )
                  }
                >
                  <option value="DAILY">Journalier</option>
                  <option value="WEEKLY">Hebdomadaire</option>
                  <option value="MONTHLY">Mensuel</option>
                  <option value="YEARLY">Annuel</option>
                </select>
              </label>
              {livretFreq === "WEEKLY" && (
                <label className="w-full sm:w-32">
                  <FieldLabel>Jour</FieldLabel>
                  <select
                    className="input w-full !py-1.5"
                    value={livretDow}
                    onChange={(e) => setLivretDow(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <option key={d} value={d}>
                        {DOW_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(livretFreq === "MONTHLY" || livretFreq === "YEARLY") && (
                <label className="w-full sm:w-28">
                  <FieldLabel>Jour du mois</FieldLabel>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className="input w-full !py-1.5"
                    value={livretDom}
                    onChange={(e) => setLivretDom(Number(e.target.value))}
                  />
                </label>
              )}
              {livretFreq === "YEARLY" && (
                <label className="w-full sm:w-32">
                  <FieldLabel>Mois</FieldLabel>
                  <select
                    className="input w-full !py-1.5"
                    value={livretMonth}
                    onChange={(e) => setLivretMonth(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={m}>
                        {MONTH_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="w-full text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                Les intérêts courus s&apos;affichent en temps réel ; le bouton
                « Actualiser les intérêts » crédite au solde les périodes déjà
                échues selon la règle de chaque livret.
              </p>
            </div>
          )}
        </div>

        {/* Liste livrets — lignes compactes + réglages au clic */}
        <div className="card overflow-hidden" data-testid="banks-savings-list">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <p className="text-[11px] font-medium text-[var(--muted-foreground)]">
              Livrets enregistrés
              {!savingsQ.isLoading && (
                <span className="ml-1.5 tabular-nums">· {savings.length}</span>
              )}
            </p>
          </div>

          {savings.length === 0 && !savingsQ.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
              Aucun livret — ajoutez-en un ci-dessus
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {savings.map((a) => {
                const open = Boolean(expandedSavings[a.id]);
                return (
                  <li key={a.id} className="px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className="input !w-auto min-w-[8rem] max-w-[14rem] !py-1 font-medium"
                            defaultValue={a.name}
                            key={`${a.id}-name-${a.name}`}
                            onBlur={(e) => {
                              if (e.target.value !== a.name)
                                patchSavings.mutate({
                                  id: a.id,
                                  name: e.target.value,
                                });
                            }}
                          />
                          <NetWorthBadge
                            included={a.countsInNetWorth}
                            compact
                          />
                        </div>
                        <p className="text-meta mt-1">
                          {a.rateType || "APY"} {a.apyPercent}&nbsp;% ·{" "}
                          {a.payoutRuleLabel}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                          Solde affiché
                        </p>
                        <p className="text-base font-semibold tabular-nums text-[var(--foreground)]">
                          {formatCurrency(a.displayBalance, a.currency)}
                        </p>
                        <p className="text-[10px] text-[var(--muted-foreground)]">
                          Crédité{" "}
                          {formatCurrency(a.balance, a.currency)}
                          {a.daysElapsed > 0 && (
                            <> · {a.daysElapsed}&nbsp;j courus</>
                          )}
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                          +
                          {formatCurrency(
                            a.periodInterest || a.dailyInterest,
                            a.currency
                          )}
                          <span className="font-normal text-[var(--muted-foreground)]">
                            {" "}
                            / période
                          </span>
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-[11px]"
                          aria-expanded={open}
                          onClick={() =>
                            setExpandedSavings((prev) => ({
                              ...prev,
                              [a.id]: !prev[a.id],
                            }))
                          }
                        >
                          Régler
                          <ChevronDown
                            className={cn(
                              "ml-0.5 h-3.5 w-3.5 transition-transform",
                              open && "rotate-180"
                            )}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Supprimer"
                          aria-label="Supprimer le livret"
                          onClick={() =>
                            fetchJson(`/api/savings?id=${a.id}`, {
                              method: "DELETE",
                            }).then(refresh)
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>

                    {open && (
                      <div className="mt-3 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/15 p-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Solde crédité
                          <input
                            className="input mt-1 w-full !py-1.5 text-right tabular-nums"
                            defaultValue={a.balance}
                            key={`${a.id}-bal-${a.balance}`}
                            onBlur={(e) => {
                              if (e.target.value !== a.balance)
                                patchSavings.mutate({
                                  id: a.id,
                                  balance: e.target.value,
                                });
                            }}
                          />
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Devise
                          <div className="mt-1">
                            <CurrencySelect
                              value={a.currency || "EUR"}
                              className="w-full"
                              onChange={(currency) => {
                                if (currency !== a.currency) {
                                  patchSavings.mutate({ id: a.id, currency });
                                }
                              }}
                            />
                          </div>
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Type de taux
                          <select
                            className="input mt-1 w-full !py-1.5"
                            value={a.rateType || "APY"}
                            onChange={(e) =>
                              patchSavings.mutate({
                                id: a.id,
                                rateType: e.target.value,
                              })
                            }
                          >
                            <option value="APY">APY</option>
                            <option value="APR">APR</option>
                          </select>
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Taux %
                          <input
                            className="input mt-1 w-full !py-1.5 text-right tabular-nums"
                            defaultValue={a.apyPercent}
                            key={`${a.id}-apy-${a.apyPercent}`}
                            onBlur={(e) => {
                              if (e.target.value !== a.apyPercent)
                                patchSavings.mutate({
                                  id: a.id,
                                  apyPercent: e.target.value,
                                });
                            }}
                          />
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)] sm:col-span-2">
                          Périodicité
                          <select
                            className="input mt-1 w-full !py-1.5"
                            value={a.payoutFrequency || "DAILY"}
                            onChange={(e) =>
                              patchSavings.mutate({
                                id: a.id,
                                payoutFrequency: e.target.value,
                              })
                            }
                          >
                            <option value="DAILY">Journalier</option>
                            <option value="WEEKLY">Hebdomadaire</option>
                            <option value="MONTHLY">Mensuel</option>
                            <option value="YEARLY">Annuel</option>
                          </select>
                        </label>
                        {a.payoutFrequency === "WEEKLY" && (
                          <label className="text-[11px] text-[var(--muted-foreground)]">
                            Jour
                            <select
                              className="input mt-1 w-full !py-1.5"
                              value={a.payoutDayOfWeek ?? 1}
                              onChange={(e) =>
                                patchSavings.mutate({
                                  id: a.id,
                                  payoutDayOfWeek: e.target.value,
                                })
                              }
                            >
                              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                                <option key={d} value={d}>
                                  {DOW_LABELS[d]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {(a.payoutFrequency === "MONTHLY" ||
                          a.payoutFrequency === "YEARLY") && (
                          <label className="text-[11px] text-[var(--muted-foreground)]">
                            Jour du mois
                            <input
                              type="number"
                              min={1}
                              max={31}
                              className="input mt-1 w-full !py-1.5"
                              defaultValue={a.payoutDayOfMonth ?? 1}
                              key={`${a.id}-dom-${a.payoutDayOfMonth}`}
                              onBlur={(e) =>
                                patchSavings.mutate({
                                  id: a.id,
                                  payoutDayOfMonth: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        {a.payoutFrequency === "YEARLY" && (
                          <label className="text-[11px] text-[var(--muted-foreground)]">
                            Mois
                            <select
                              className="input mt-1 w-full !py-1.5"
                              value={a.payoutMonth ?? 12}
                              onChange={(e) =>
                                patchSavings.mutate({
                                  id: a.id,
                                  payoutMonth: e.target.value,
                                })
                              }
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {MONTH_LABELS[m]}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                        )}
                        {a.lastPayoutAt && (
                          <p className="text-meta sm:col-span-2">
                            Dernier versement :{" "}
                            {new Date(a.lastPayoutAt).toLocaleDateString(
                              "fr-FR"
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            Solde affiché = solde crédité + intérêts courus non encore versés.
            La conversion en {baseCurrency} sert uniquement au patrimoine
            agrégé. « Actualiser les intérêts » capitalise les périodes dues.
          </p>
        </div>
      </section>
    </div>
  );
}

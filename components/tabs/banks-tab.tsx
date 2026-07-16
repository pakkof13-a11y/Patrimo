"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BANK_OPTIONS } from "@/app/lib/constants";
import { ACCOUNT_CURRENCY_OPTIONS, currencyLabel } from "@/app/lib/money/currencies";
import { formatCurrency, cn } from "@/app/lib/utils";
import { toast } from "sonner";

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
      className={cn("input !py-1", className)}
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
    // Refresh often so daily credits / display accrual stay fresh
    refetchInterval: 60_000,
  });

  const [bankName, setBankName] = useState("Revolut");
  const [bankBalance, setBankBalance] = useState("0");
  const [bankCurrency, setBankCurrency] = useState("EUR");
  const [livretName, setLivretName] = useState("Livret A");
  const [livretBalance, setLivretBalance] = useState("0");
  const [livretApy, setLivretApy] = useState("3");
  const [livretRateType, setLivretRateType] = useState<"APR" | "APY">("APY");
  const [livretFreq, setLivretFreq] = useState<"DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY">(
    "DAILY"
  );
  const [livretDow, setLivretDow] = useState(1);
  const [livretDom, setLivretDom] = useState(1);
  const [livretMonth, setLivretMonth] = useState(12);
  const [livretCurrency, setLivretCurrency] = useState("EUR");

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
            livretFreq === "MONTHLY" || livretFreq === "YEARLY" ? livretDom : null,
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
      fetchJson<{ periodsCredited?: number }>("/api/savings/accrue", { method: "POST" }),
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

  return (
    <div className="space-y-8">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Comptes courants</h2>
            <p className="text-xs text-zinc-500">
              Solde par défaut 0 — compté dans le patrimoine uniquement si &gt; 0 · devise par compte
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              Banque
              <select
                className="input mt-1 !w-40"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              >
                {BANK_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Solde
              <input
                className="input mt-1 !w-28"
                value={bankBalance}
                onChange={(e) => setBankBalance(e.target.value)}
              />
            </label>
            <label className="text-xs">
              Devise
              <div className="mt-1">
                <CurrencySelect
                  value={bankCurrency}
                  onChange={setBankCurrency}
                  className="!w-28"
                  title="Devise du compte courant"
                />
              </div>
            </label>
            <Button size="sm" onClick={() => addBank.mutate()} disabled={addBank.isPending}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="table-head text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Banque</th>
              <th className="px-4 py-2 text-right">Solde</th>
              <th className="px-4 py-2 text-left">Devise</th>
              <th className="px-4 py-2 text-center">Patrimoine</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(banksQ.data?.accounts || []).map((a) => (
              <tr key={a.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-2">
                  <select
                    className="input !py-1"
                    value={a.bankName}
                    onChange={(e) =>
                      patchBank.mutate({ id: a.id, bankName: e.target.value })
                    }
                  >
                    {[a.bankName, ...BANK_OPTIONS.filter((b) => b !== a.bankName)].map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    className="input !w-32 !py-1 text-right tabular-nums"
                    defaultValue={a.balance}
                    key={`${a.id}-bal-${a.balance}`}
                    onBlur={(e) => {
                      if (e.target.value !== a.balance) {
                        patchBank.mutate({ id: a.id, balance: e.target.value });
                      }
                    }}
                  />
                </td>
                <td className="px-4 py-2">
                  <CurrencySelect
                    value={a.currency || "EUR"}
                    className="!w-28"
                    title="Devise de ce compte (pas de conversion du solde nominal)"
                    onChange={(currency) => {
                      if (currency !== a.currency) {
                        patchBank.mutate({ id: a.id, currency });
                      }
                    }}
                  />
                </td>
                <td className="px-4 py-2 text-center text-xs">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      a.countsInNetWorth
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                    )}
                  >
                    {a.countsInNetWorth ? "Inclus" : "Ignoré (0)"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      fetchJson(`/api/banks?id=${a.id}`, { method: "DELETE" }).then(refresh)
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </td>
              </tr>
            ))}
            {(banksQ.data?.accounts || []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                  Aucun compte courant
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Livrets d&apos;épargne</h2>
            <p className="text-xs text-zinc-500 max-w-xl">
              APR : r = R/n · APY : r = (1+R)^(1/n)−1 · Versement auto selon la périodicité
              (crédit au solde). Devise du livret uniquement.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => accrueMut.mutate()}
            disabled={accrueMut.isPending}
            title="Crédit immédiat des périodes dues"
          >
            Actualiser les intérêts
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--border)] px-4 py-3 bg-[var(--muted)]/20">
          <label className="text-xs">
            Nom
            <input
              className="input mt-1 !w-32"
              value={livretName}
              onChange={(e) => setLivretName(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Solde
            <input
              className="input mt-1 !w-24"
              value={livretBalance}
              onChange={(e) => setLivretBalance(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Type
            <select
              className="input mt-1 !w-24"
              value={livretRateType}
              onChange={(e) => setLivretRateType(e.target.value as "APR" | "APY")}
            >
              <option value="APY">APY</option>
              <option value="APR">APR</option>
            </select>
          </label>
          <label className="text-xs">
            Taux %
            <input
              className="input mt-1 !w-16"
              value={livretApy}
              onChange={(e) => setLivretApy(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Périodicité
            <select
              className="input mt-1 !w-32"
              value={livretFreq}
              onChange={(e) =>
                setLivretFreq(e.target.value as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY")
              }
            >
              <option value="DAILY">Journalier</option>
              <option value="WEEKLY">Hebdomadaire</option>
              <option value="MONTHLY">Mensuel</option>
              <option value="YEARLY">Annuel</option>
            </select>
          </label>
          {livretFreq === "WEEKLY" && (
            <label className="text-xs">
              Jour
              <select
                className="input mt-1 !w-28"
                value={livretDow}
                onChange={(e) => setLivretDow(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"][d]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(livretFreq === "MONTHLY" || livretFreq === "YEARLY") && (
            <label className="text-xs">
              Jour du mois
              <input
                type="number"
                min={1}
                max={31}
                className="input mt-1 !w-16"
                value={livretDom}
                onChange={(e) => setLivretDom(Number(e.target.value))}
              />
            </label>
          )}
          {livretFreq === "YEARLY" && (
            <label className="text-xs">
              Mois
              <select
                className="input mt-1 !w-28"
                value={livretMonth}
                onChange={(e) => setLivretMonth(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                  <option key={m} value={m}>
                    {
                      [
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
                      ][m]
                    }
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs">
            Devise
            <div className="mt-1">
              <CurrencySelect
                value={livretCurrency}
                onChange={setLivretCurrency}
                className="!w-28"
                title="Devise nominale du livret"
              />
            </div>
          </label>
          <Button size="sm" onClick={() => addSavings.mutate()} disabled={addSavings.isPending}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>

        <div className="table-container-responsive table-fluid-wrap">
          <table className="table-fluid text-sm">
            <thead className="table-head text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Livret</th>
                <th className="px-3 py-2 text-right">Solde crédité</th>
                <th className="px-3 py-2 text-left">Devise</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Taux %</th>
                <th className="px-3 py-2 text-left">Périodicité / règle</th>
                <th className="px-3 py-2 text-right">Solde affiché*</th>
                <th className="px-3 py-2 text-right">Intérêt / période</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(savingsQ.data?.accounts || []).map((a) => (
                <tr key={a.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">
                    <input
                      className="input !py-1"
                      defaultValue={a.name}
                      key={`${a.id}-name-${a.name}`}
                      onBlur={(e) => {
                        if (e.target.value !== a.name)
                          patchSavings.mutate({ id: a.id, name: e.target.value });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="input !w-28 !py-1 text-right"
                      defaultValue={a.balance}
                      key={`${a.id}-bal-${a.balance}`}
                      onBlur={(e) => {
                        if (e.target.value !== a.balance)
                          patchSavings.mutate({ id: a.id, balance: e.target.value });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <CurrencySelect
                      value={a.currency || "EUR"}
                      className="!w-24"
                      onChange={(currency) => {
                        if (currency !== a.currency) {
                          patchSavings.mutate({ id: a.id, currency });
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="input !py-1 !w-20"
                      value={a.rateType || "APY"}
                      onChange={(e) =>
                        patchSavings.mutate({ id: a.id, rateType: e.target.value })
                      }
                    >
                      <option value="APY">APY</option>
                      <option value="APR">APR</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="input !w-16 !py-1 text-right"
                      defaultValue={a.apyPercent}
                      key={`${a.id}-apy-${a.apyPercent}`}
                      onBlur={(e) => {
                        if (e.target.value !== a.apyPercent)
                          patchSavings.mutate({ id: a.id, apyPercent: e.target.value });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <select
                        className="input !py-1 text-xs"
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
                      {a.payoutFrequency === "WEEKLY" && (
                        <select
                          className="input !py-1 text-xs"
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
                              {
                                [
                                  "",
                                  "Lundi",
                                  "Mardi",
                                  "Mercredi",
                                  "Jeudi",
                                  "Vendredi",
                                  "Samedi",
                                  "Dimanche",
                                ][d]
                              }
                            </option>
                          ))}
                        </select>
                      )}
                      {(a.payoutFrequency === "MONTHLY" ||
                        a.payoutFrequency === "YEARLY") && (
                        <input
                          type="number"
                          min={1}
                          max={31}
                          className="input !py-1 text-xs !w-16"
                          title="Jour du mois"
                          defaultValue={a.payoutDayOfMonth ?? 1}
                          key={`${a.id}-dom-${a.payoutDayOfMonth}`}
                          onBlur={(e) =>
                            patchSavings.mutate({
                              id: a.id,
                              payoutDayOfMonth: e.target.value,
                            })
                          }
                        />
                      )}
                      {a.payoutFrequency === "YEARLY" && (
                        <select
                          className="input !py-1 text-xs"
                          value={a.payoutMonth ?? 12}
                          onChange={(e) =>
                            patchSavings.mutate({
                              id: a.id,
                              payoutMonth: e.target.value,
                            })
                          }
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                            <option key={m} value={m}>
                              {
                                [
                                  "",
                                  "Janv.",
                                  "Févr.",
                                  "Mars",
                                  "Avr.",
                                  "Mai",
                                  "Juin",
                                  "Juil.",
                                  "Août",
                                  "Sept.",
                                  "Oct.",
                                  "Nov.",
                                  "Déc.",
                                ][m]
                              }
                            </option>
                          ))}
                        </select>
                      )}
                      <span className="text-[10px] text-zinc-500">{a.payoutRuleLabel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatCurrency(a.displayBalance, a.currency)}
                    <div className="text-[10px] font-normal text-zinc-400">
                      {a.daysElapsed} j · {a.countsInNetWorth ? "inclus" : "ignoré (0)"}
                      {a.lastPayoutAt && (
                        <>
                          <br />
                          versé {new Date(a.lastPayoutAt).toLocaleDateString("fr-FR")}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{formatCurrency(a.periodInterest || a.dailyInterest, a.currency)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        fetchJson(`/api/savings?id=${a.id}`, { method: "DELETE" }).then(
                          refresh
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
              {(savingsQ.data?.accounts || []).length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-zinc-400">
                    Aucun livret
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-zinc-500">
          * Solde affiché = solde crédité + intérêts courus non encore versés (pro-rata). Les
          versements sont capitalisés automatiquement selon la règle (GET livrets / bouton /
          cron). Conversion en {baseCurrency} pour le patrimoine agrégé uniquement.
        </p>
      </section>
    </div>
  );
}

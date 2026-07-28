"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Landmark } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import { TRADING_ACCOUNT_TYPES } from "@/app/lib/trading/constants";
import type { TradingBundle, TradingPositionRow } from "./types";

const emptyForm = {
  brokerName: "",
  accountType: "CFD",
  currency: "EUR",
  balance: "",
  marginAvailable: "",
  openDate: "",
};

/**
 * Comptes de trading et positions non crypto.
 *
 * Les futures crypto gardent leur écran dédié : ils ont leur propre import de
 * relevés et leurs notions propres (funding, marge isolée/croisée). Ce panneau
 * couvre le reste — CFD sur indices, forex, matières premières — et la gestion
 * des comptes, commune aux deux.
 */
export function TradingAccountsPanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const q = useQuery({
    queryKey: ["trading"],
    queryFn: () => fetchJson<TradingBundle>("/api/trading"),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["trading"] });
    void qc.invalidateQueries({ queryKey: ["crypto-futures"] });
  };

  const createAccount = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/trading/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brokerName: form.brokerName,
          accountType: form.accountType,
          currency: form.currency || "EUR",
          balance: form.balance || null,
          marginAvailable: form.marginAvailable || null,
          openDate: form.openDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Création impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("Compte enregistré");
      setForm(emptyForm);
      setShowForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const attach = useMutation({
    mutationFn: async (vars: {
      positionId: string;
      tradingAccountId: string | null;
    }) => {
      const res = await fetch("/api/trading/positions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Rattachement impossible");
      return json;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const accounts = useMemo(() => q.data?.accounts ?? [], [q.data]);
  const positions = useMemo(() => q.data?.positions ?? [], [q.data]);

  // Les futures crypto ont leur propre écran : les répéter ici ferait deux
  // endroits pour la même ligne, avec deux façons de la modifier.
  const nonCrypto = useMemo(
    () => positions.filter((p) => p.underlyingType !== "CRYPTO"),
    [positions]
  );

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  if (q.isPending) return <Skeleton className={cn("h-64 w-full", className)} />;

  return (
    <section
      className={cn("card p-4", className)}
      data-testid="trading-accounts-panel"
    >
      <PanelHeader
        title="Comptes & CFD"
        subtitle="Comptes chez vos courtiers, et positions sur indices, forex ou matières premières"
        actions={
          <Button
            type="button"
            variant={showForm ? "outline" : "default"}
            onClick={() => setShowForm((v) => !v)}
            data-testid="trading-account-form-toggle"
          >
            {showForm ? "Annuler" : "Ajouter un compte"}
          </Button>
        }
      />

      {showForm && (
        <div
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3"
          data-testid="trading-account-form"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-meta block">
              Courtier
              <input
                className="input mt-1 w-full"
                placeholder="IG, XTB, Saxo, Interactive Brokers…"
                value={form.brokerName}
                onChange={(e) => set("brokerName", e.target.value)}
                data-testid="trading-broker"
              />
            </label>

            <label className="text-meta block">
              Type de compte
              <select
                className="input mt-1 w-full"
                value={form.accountType}
                onChange={(e) => set("accountType", e.target.value)}
                data-testid="trading-account-type"
              >
                {Object.entries(TRADING_ACCOUNT_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Devise
              <input
                className="input mt-1 w-full"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Solde
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.balance}
                onChange={(e) => set("balance", e.target.value)}
                data-testid="trading-balance"
              />
            </label>

            <label className="text-meta block">
              Marge disponible
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.marginAvailable}
                onChange={(e) => set("marginAvailable", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Date d&apos;ouverture
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.openDate}
                onChange={(e) => set("openDate", e.target.value)}
              />
            </label>
          </div>

          <p className="text-meta mt-2">
            Le solde et la marge sont déclaratifs : ils viennent du relevé du
            courtier, aucun calcul ne peut les reconstituer. Le P&amp;L, lui,
            est toujours recalculé depuis les positions.
          </p>

          <div className="mt-3">
            <Button
              type="button"
              disabled={!form.brokerName.trim() || createAccount.isPending}
              onClick={() => createAccount.mutate()}
              data-testid="trading-account-submit"
            >
              {createAccount.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyPlaceholder
          compact
          title="Aucun compte de trading"
          description="Déclarez un compte CFD ou futures pour suivre son solde, sa marge disponible et les positions qui s'y rattachent."
        />
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <div
              key={a.id}
              className="rounded-[var(--radius-md)] border border-[var(--border)] p-3"
              data-testid="trading-account-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Landmark
                      className="h-3.5 w-3.5 text-[var(--muted-foreground)]"
                      aria-hidden
                    />
                    <span className="truncate text-sm font-medium">
                      {a.brokerName}
                    </span>
                  </div>
                  <span className="text-meta">{a.accountTypeLabel}</span>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatCurrency(a.balance, a.currency)}
                  </p>
                  {a.marginAvailable && (
                    <p className="text-meta tabular-nums">
                      {formatCurrency(a.marginAvailable, a.currency)} dispo.
                    </p>
                  )}
                </div>
              </div>
              <p className="text-meta mt-1.5">
                {a.openPositionCount} ouverte(s) · {a.positionCount} au total
              </p>
            </div>
          ))}
        </div>
      )}

      {nonCrypto.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs" data-testid="trading-cfd-table">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <th className="py-1.5 pr-2">Instrument</th>
                <th className="py-1.5 pr-2">Sous-jacent</th>
                <th className="py-1.5 pr-2">Sens</th>
                <th className="py-1.5 pr-2">Compte</th>
                <th className="py-1.5 pr-2 text-right">Levier</th>
                <th className="py-1.5 pr-2 text-right">Entrée</th>
                <th className="py-1.5 text-right">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {nonCrypto.map((p) => (
                <PositionRow
                  key={p.id}
                  p={p}
                  accounts={accounts}
                  disabled={attach.isPending}
                  onAttach={(id) =>
                    attach.mutate({
                      positionId: p.id,
                      tradingAccountId: id,
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PositionRow({
  p,
  accounts,
  disabled,
  onAttach,
}: {
  p: TradingPositionRow;
  accounts: TradingBundle["accounts"];
  disabled: boolean;
  onAttach: (id: string | null) => void;
}) {
  const pnl = p.isOpen ? p.unrealizedPnl : p.realizedPnl;
  const value = Number(pnl ?? 0);
  return (
    <tr className="border-b border-[var(--border)]/50" data-testid="trading-cfd-row">
      <td className="py-1.5 pr-2 font-medium">{p.instrument}</td>
      <td className="py-1.5 pr-2">
        <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
          {p.underlyingType}
        </span>
      </td>
      <td className="py-1.5 pr-2">
        <span
          className={cn(
            "text-[11px] font-medium",
            p.direction === "LONG"
              ? "text-[var(--success)]"
              : "text-[var(--danger)]"
          )}
        >
          {p.direction}
        </span>
      </td>
      <td className="py-1.5 pr-2">
        <select
          className="input h-7 w-full min-w-[8rem] py-0 text-[11px]"
          value={p.tradingAccountId ?? ""}
          disabled={disabled || accounts.length === 0}
          onChange={(e) => onAttach(e.target.value || null)}
          data-testid="trading-row-account"
        >
          <option value="">— non rattachée —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.brokerName}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">
        ×{Number(p.leverage).toLocaleString("fr-FR")}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">
        {Number(p.entryPrice).toLocaleString("fr-FR", {
          maximumFractionDigits: 4,
        })}
      </td>
      <td
        className={cn(
          "py-1.5 text-right font-medium tabular-nums",
          value < 0 ? "text-[var(--danger)]" : "text-[var(--success)]"
        )}
      >
        {pnl != null ? formatCurrency(pnl, "EUR") : "—"}
        {p.isOpen && <span className="text-meta ml-1">latent</span>}
      </td>
    </tr>
  );
}

"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Upload } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  CRYPTO_EXCHANGES,
  CRYPTO_MARGIN_TYPES,
  FUTURES_IMPORT_EXCHANGES,
  exchangeLabel,
} from "@/app/lib/crypto/futures-constants";

type OpenPosition = {
  id: string;
  exchange: string;
  pair: string;
  direction: "LONG" | "SHORT";
  leverage: string;
  sizeContracts: string;
  notionalUsd: string;
  entryPrice: string;
  markPrice: string | null;
  marginUsed: string;
  unrealizedPnlEur: string;
  liquidationPrice: string | null;
  distanceToLiquidationPct: number | null;
  liquidationAlert: boolean;
  fundingAlert: boolean;
  stopLoss: string | null;
  takeProfit: string | null;
};

type ClosedPosition = {
  id: string;
  exchange: string;
  pair: string;
  direction: "LONG" | "SHORT";
  leverage: string;
  entryPrice: string;
  exitPrice: string | null;
  sizeContracts: string;
  realizedPnl: string | null;
  fundingPaid: string | null;
  commissionPaid: string | null;
  closedAt: string | null;
};

type FuturesResponse = {
  open: OpenPosition[];
  closed: ClosedPosition[];
  summary: {
    totalMarginEur: string;
    netExposureEur: string;
    unrealizedPnlEur: string;
    positionCount: number;
    liquidationAlerts: number;
  };
};

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const emptyForm = {
  exchange: "BINANCE",
  pair: "",
  marginType: "USDT_M",
  baseCurrency: "",
  quoteCurrency: "USDT",
  direction: "LONG" as "LONG" | "SHORT",
  leverage: "",
  sizeContracts: "",
  entryPrice: "",
  markPrice: "",
  stopLoss: "",
  takeProfit: "",
  openedAt: new Date().toISOString().slice(0, 10),
};

/**
 * Onglet Futures — positions à levier sur exchanges crypto.
 *
 * Une position ici n'est pas un actif détenu : ce qu'elle pèse au patrimoine
 * est la marge engagée plus le P&L latent, pas « quantité × prix ». C'est
 * pourquoi ce panneau ne s'appuie ni sur le journal ni sur `getHoldings()` —
 * les totaux qu'il affiche lui sont propres, à la différence du Comptant et
 * de la DeFi.
 */
export function FuturesPanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showClosed, setShowClosed] = useState(false);
  const [importExchange, setImportExchange] = useState<string>("BINANCE");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const q = useQuery({
    queryKey: ["crypto-futures"],
    queryFn: () => fetchJson<FuturesResponse>("/api/crypto/futures"),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["crypto-futures"] });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crypto/futures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          markPrice: form.markPrice || null,
          stopLoss: form.stopLoss || null,
          takeProfit: form.takeProfit || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Création impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("Position ouverte");
      setForm(emptyForm);
      setShowForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/crypto/futures", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, close: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Clôture impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("Position clôturée");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/crypto/futures?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Suppression impossible");
      }
    },
    onSuccess: () => {
      toast.success("Position supprimée");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runImport = useMutation({
    mutationFn: async (csv: string) => {
      const res = await fetch("/api/crypto/futures/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange: importExchange, csv }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Import impossible");
      return json as { created: number; updated: number; rowsSkipped: number };
    },
    onSuccess: (r) => {
      toast.success(
        `Import terminé — ${r.created} créée(s), ${r.updated} mise(s) à jour${
          r.rowsSkipped ? `, ${r.rowsSkipped} ligne(s) ignorée(s)` : ""
        }`
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onFilePicked(file: File) {
    const reader = new FileReader();
    reader.onload = () => runImport.mutate(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canSubmit =
    form.pair.trim() &&
    form.baseCurrency.trim() &&
    form.leverage &&
    form.sizeContracts &&
    form.entryPrice;

  const summary = q.data?.summary;
  const open = q.data?.open ?? [];
  const closedList = q.data?.closed ?? [];

  if (q.isPending) {
    return <Skeleton className={cn("h-64 w-full", className)} />;
  }

  return (
    <section className={cn("card p-4", className)} data-testid="crypto-futures-panel">
      <PanelHeader
        title="Positions futures"
        subtitle="Perpétuels à levier — marge engagée et P&L latent, hors journal"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <select
              className="input w-full h-8 text-xs"
              value={importExchange}
              onChange={(e) => setImportExchange(e.target.value)}
              data-testid="futures-import-exchange"
            >
              {FUTURES_IMPORT_EXCHANGES.map((ex) => (
                <option key={ex} value={ex}>
                  {exchangeLabel(ex)}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFilePicked(f);
                e.target.value = "";
              }}
              data-testid="futures-import-file"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={runImport.isPending}
              data-testid="futures-import-trigger"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {runImport.isPending ? "Import…" : "Importer CSV"}
            </Button>
            <Button
              type="button"
              variant={showForm ? "outline" : "default"}
              onClick={() => setShowForm((v) => !v)}
              data-testid="futures-form-toggle"
            >
              {showForm ? "Annuler" : "Ouvrir une position"}
            </Button>
          </div>
        }
      />

      {showForm && (
        <div
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3"
          data-testid="futures-form"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-meta block">
              Exchange
              <select
                className="input mt-1 w-full"
                value={form.exchange}
                onChange={(e) => set("exchange", e.target.value)}
                data-testid="futures-exchange"
              >
                {Object.entries(CRYPTO_EXCHANGES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Paire
              <input
                className="input mt-1 w-full"
                placeholder="BTC/USDT-PERP"
                value={form.pair}
                onChange={(e) => set("pair", e.target.value)}
                data-testid="futures-pair"
              />
            </label>

            <label className="text-meta block">
              Devise de base
              <input
                className="input mt-1 w-full"
                placeholder="BTC"
                value={form.baseCurrency}
                onChange={(e) => set("baseCurrency", e.target.value)}
                data-testid="futures-base-currency"
              />
            </label>

            <label className="text-meta block">
              Marge
              <select
                className="input mt-1 w-full"
                value={form.marginType}
                onChange={(e) => set("marginType", e.target.value)}
              >
                {Object.entries(CRYPTO_MARGIN_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Sens
              <select
                className="input mt-1 w-full"
                value={form.direction}
                onChange={(e) => set("direction", e.target.value as "LONG" | "SHORT")}
                data-testid="futures-direction"
              >
                <option value="LONG">Long</option>
                <option value="SHORT">Short</option>
              </select>
            </label>

            <label className="text-meta block">
              Levier
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                placeholder="10"
                value={form.leverage}
                onChange={(e) => set("leverage", e.target.value)}
                data-testid="futures-leverage"
              />
            </label>

            <label className="text-meta block">
              Taille (contrats)
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.sizeContracts}
                onChange={(e) => set("sizeContracts", e.target.value)}
                data-testid="futures-size"
              />
            </label>

            <label className="text-meta block">
              Prix d&apos;entrée
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.entryPrice}
                onChange={(e) => set("entryPrice", e.target.value)}
                data-testid="futures-entry-price"
              />
            </label>

            <label className="text-meta block">
              Stop loss
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.stopLoss}
                onChange={(e) => set("stopLoss", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Take profit
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.takeProfit}
                onChange={(e) => set("takeProfit", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Date d&apos;ouverture
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.openedAt}
                onChange={(e) => set("openedAt", e.target.value)}
              />
            </label>
          </div>

          <p className="text-meta mt-2">
            Marge requise et prix de liquidation estimé sont calculés
            automatiquement une fois la position enregistrée.
          </p>

          <div className="mt-3">
            <Button
              type="button"
              disabled={!canSubmit || create.isPending}
              onClick={() => create.mutate()}
              data-testid="futures-submit"
            >
              {create.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      )}

      {open.length === 0 && closedList.length === 0 ? (
        <EmptyPlaceholder
          compact
          title="Aucune position futures"
          description="Importez un relevé de trades (Binance, Bybit, OKX) ou ouvrez une position à la main."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Marge engagée", value: num(summary?.totalMarginEur) },
              {
                label: "Exposition nette",
                value: num(summary?.netExposureEur),
                strong: true,
              },
              { label: "P&L latent", value: num(summary?.unrealizedPnlEur) },
            ].map((k) => (
              <div
                key={k.label}
                className={cn(
                  "rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2",
                  k.strong && "bg-[var(--muted)]/40"
                )}
              >
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  {k.label}
                </p>
                <p
                  className={cn(
                    "mt-0.5 tabular-nums",
                    k.strong ? "text-sm font-semibold" : "text-xs font-medium",
                    k.value < 0 && "text-[var(--danger)]"
                  )}
                >
                  {formatCurrency(String(k.value), "EUR")}
                </p>
              </div>
            ))}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                Positions ouvertes
              </p>
              <p className="mt-0.5 text-xs font-medium tabular-nums">
                {summary?.positionCount ?? 0}
              </p>
            </div>
          </div>

          {summary && summary.liquidationAlerts > 0 && (
            <div
              className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]"
              data-testid="futures-liquidation-alert"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {summary.liquidationAlerts} position(s) à moins de 15 % de leur
                prix de liquidation estimé.
              </span>
            </div>
          )}

          {open.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs" data-testid="futures-open-table">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="py-1.5 pr-2">Exchange</th>
                    <th className="py-1.5 pr-2">Paire</th>
                    <th className="py-1.5 pr-2">Sens</th>
                    <th className="py-1.5 pr-2 text-right">Levier</th>
                    <th className="py-1.5 pr-2 text-right">Entrée</th>
                    <th className="py-1.5 pr-2 text-right">Marge</th>
                    <th className="py-1.5 pr-2 text-right">Liq. estimée</th>
                    <th className="py-1.5 pr-2 text-right">P&L latent</th>
                    <th className="py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--border)]/50"
                      data-testid="futures-open-row"
                    >
                      <td className="py-1.5 pr-2">{exchangeLabel(p.exchange)}</td>
                      <td className="py-1.5 pr-2 font-medium">{p.pair}</td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                            p.direction === "LONG"
                              ? "border-[var(--success)]/40 text-[var(--success)]"
                              : "border-[var(--danger)]/40 text-[var(--danger)]"
                          )}
                        >
                          {p.direction === "LONG" ? "Long" : "Short"}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {Number(p.leverage).toLocaleString("fr-FR")}×
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {Number(p.entryPrice).toLocaleString("fr-FR")}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatCurrency(p.marginUsed, "EUR")}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {p.liquidationPrice ? (
                          <span
                            className={cn(
                              p.liquidationAlert && "font-medium text-[var(--danger)]"
                            )}
                          >
                            {Number(p.liquidationPrice).toLocaleString("fr-FR")}
                            {p.distanceToLiquidationPct != null && (
                              <span className="text-meta ml-1">
                                ({p.distanceToLiquidationPct.toLocaleString("fr-FR", {
                                  maximumFractionDigits: 1,
                                })}
                                %)
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right font-medium tabular-nums",
                          num(p.unrealizedPnlEur) < 0 && "text-[var(--danger)]"
                        )}
                      >
                        {formatCurrency(p.unrealizedPnlEur, "EUR")}
                        {p.fundingAlert && (
                          <span title="Funding élevé — plus de 1 % de la marge">
                            {" "}⚠
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px]"
                            onClick={() => close.mutate(p.id)}
                            data-testid="futures-close-btn"
                          >
                            Clôturer
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px] text-[var(--danger)]"
                            onClick={() => remove.mutate(p.id)}
                          >
                            Suppr.
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {closedList.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                className="text-label text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                onClick={() => setShowClosed((v) => !v)}
                data-testid="futures-closed-toggle"
              >
                {`${showClosed ? "Masquer" : "Afficher"} l'historique (${closedList.length})`}
              </button>

              {showClosed && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs" data-testid="futures-closed-table">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                        <th className="py-1.5 pr-2">Clôture</th>
                        <th className="py-1.5 pr-2">Paire</th>
                        <th className="py-1.5 pr-2">Sens</th>
                        <th className="py-1.5 pr-2 text-right">Entrée → Sortie</th>
                        <th className="py-1.5 text-right">P&L réalisé</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedList.map((p) => (
                        <tr
                          key={p.id}
                          className="border-b border-[var(--border)]/50"
                          data-testid="futures-closed-row"
                        >
                          <td className="py-1.5 pr-2">
                            {p.closedAt
                              ? new Date(p.closedAt).toLocaleDateString("fr-FR")
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-2 font-medium">{p.pair}</td>
                          <td className="py-1.5 pr-2">
                            {p.direction === "LONG" ? "Long" : "Short"}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {Number(p.entryPrice).toLocaleString("fr-FR")} →{" "}
                            {p.exitPrice ? Number(p.exitPrice).toLocaleString("fr-FR") : "—"}
                          </td>
                          <td
                            className={cn(
                              "py-1.5 text-right font-medium tabular-nums",
                              num(p.realizedPnl) < 0 && "text-[var(--danger)]"
                            )}
                          >
                            {formatCurrency(p.realizedPnl ?? "0", "EUR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <p className="text-meta mt-3">
            Marge et P&L latent ne comptent pas dans le patrimoine coté du
            tableau Positions : une position à levier n&apos;est pas un actif
            détenu.
          </p>
        </>
      )}
    </section>
  );
}

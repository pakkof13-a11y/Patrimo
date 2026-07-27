"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  DEFI_POSITION_TYPES,
  defiPositionTypeLabel,
  isDebtPosition,
  type DefiPositionType,
} from "@/app/lib/crypto/constants";

type PositionRow = {
  id: string;
  protocol: string;
  chain: string | null;
  positionType: string;
  assetSymbol: string;
  valueEur: string;
  netValueEur: string;
  isDebt: boolean;
  rewardsValueEur: string | null;
  apyPct: string | null;
  healthFactor: number | null;
  ltvPct: number | null;
  healthRisk: "CRITICAL" | "WARNING" | "OK" | null;
  ltvRisk: "CRITICAL" | "WARNING" | "OK" | null;
};

type ProtocolRow = {
  protocol: string;
  chains: string[];
  depositedEur: string;
  borrowedEur: string;
  netEur: string;
  positionIds: string[];
};

type DefiResponse = {
  positions: PositionRow[];
  byProtocol: ProtocolRow[];
  byType: Array<{ positionType: string; totalEur: string; positionIds: string[] }>;
  summary: {
    depositedEur: string;
    borrowedEur: string;
    netEur: string;
    pendingRewardsEur: string;
    weightedApyPct: string | null;
    positionCount: number;
    protocolCount: number;
    worstHealthFactor: number | null;
  };
};

type PlatformRow = { id: string; name: string; type?: string | null };

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const emptyForm = {
  platformId: "",
  assetSymbol: "",
  protocol: "",
  positionType: "STAKING" as DefiPositionType,
  chain: "",
  quantity: "",
  unitPriceEur: "",
  openedAt: new Date().toISOString().slice(0, 10),
  apyPct: "",
  rewardsValueEur: "",
  healthFactor: "",
  ltvPct: "",
};

/** Couleur d'un badge de risque — le rouge est réservé au liquidable. */
function riskClass(risk: string | null): string {
  if (risk === "CRITICAL") return "text-[var(--danger)] border-[var(--danger)]/40 bg-[var(--danger)]/10";
  if (risk === "WARNING") return "text-[var(--warning)] border-[var(--warning)]/40 bg-[var(--warning)]/10";
  return "text-[var(--muted-foreground)] border-[var(--border)]";
}

/**
 * Positions DeFi — staking, prêts, emprunts, liquidité.
 *
 * Ce que ce panneau montre et que le tableau Positions ne peut pas montrer :
 * la contrepartie (le protocole), le rendement servi, et surtout la santé d'un
 * prêt collatéralisé. Une position empruntée y est comptée en négatif — c'est
 * la seule lecture patrimoniale juste, un actif déposé en garantie ne valant
 * pas la même chose selon ce qu'on a tiré dessus.
 */
export function DefiPanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const q = useQuery({
    queryKey: ["crypto-defi"],
    queryFn: () => fetchJson<DefiResponse>("/api/crypto/defi"),
  });

  const platformsQ = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fetchJson<{ platforms: PlatformRow[] }>("/api/platforms"),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crypto-defi"] });
    // La position pèse au patrimoine : la vue Positions doit suivre.
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crypto/defi/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          chain: form.chain || null,
          apyPct: form.apyPct || null,
          rewardsValueEur: form.rewardsValueEur || null,
          healthFactor: form.healthFactor || null,
          ltvPct: form.ltvPct || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Création impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("Position enregistrée");
      setForm(emptyForm);
      setShowForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const positions = q.data?.positions ?? [];
  const summary = q.data?.summary;
  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const isDebtForm = isDebtPosition(form.positionType);
  const canSubmit =
    form.platformId &&
    form.assetSymbol.trim() &&
    form.protocol.trim() &&
    form.quantity &&
    form.unitPriceEur;

  if (q.isPending) {
    return <Skeleton className={cn("h-64 w-full", className)} />;
  }

  return (
    <section className={cn("card p-4", className)} data-testid="crypto-defi-panel">
      <PanelHeader
        title="Positions DeFi"
        subtitle="Staking, prêts, emprunts et liquidité — valeur issue du journal"
        actions={
          <Button
            type="button"
            variant={showForm ? "outline" : "default"}
            onClick={() => setShowForm((v) => !v)}
            data-testid="defi-form-toggle"
          >
            {showForm ? "Annuler" : "Ajouter une position"}
          </Button>
        }
      />

      {showForm && (
        <div
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3"
          data-testid="defi-form"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-meta block">
              Plateforme
              <select
                className="input mt-1 w-full"
                value={form.platformId}
                onChange={(e) => set("platformId", e.target.value)}
                data-testid="defi-platform"
              >
                <option value="">— choisir —</option>
                {(platformsQ.data?.platforms ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Nature de la position
              <select
                className="input mt-1 w-full"
                value={form.positionType}
                onChange={(e) =>
                  set("positionType", e.target.value as DefiPositionType)
                }
                data-testid="defi-type"
              >
                {Object.entries(DEFI_POSITION_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Protocole
              <input
                className="input mt-1 w-full"
                placeholder="Aave, Lido, Uniswap…"
                value={form.protocol}
                onChange={(e) => set("protocol", e.target.value)}
                data-testid="defi-protocol"
              />
            </label>

            <label className="text-meta block">
              Actif engagé
              <input
                className="input mt-1 w-full"
                placeholder="ETH, USDC…"
                value={form.assetSymbol}
                onChange={(e) => set("assetSymbol", e.target.value)}
                data-testid="defi-symbol"
              />
            </label>

            <label className="text-meta block">
              Quantité
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.quantity}
                onChange={(e) => set("quantity", e.target.value)}
                data-testid="defi-quantity"
              />
            </label>

            <label className="text-meta block">
              Prix unitaire (€)
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.unitPriceEur}
                onChange={(e) => set("unitPriceEur", e.target.value)}
                data-testid="defi-unit-price"
              />
            </label>

            <label className="text-meta block">
              Chaîne
              <input
                className="input mt-1 w-full"
                placeholder="ethereum, solana…"
                value={form.chain}
                onChange={(e) => set("chain", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Date d&apos;engagement
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.openedAt}
                onChange={(e) => set("openedAt", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              APY (%)
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.apyPct}
                onChange={(e) => set("apyPct", e.target.value)}
                data-testid="defi-apy"
              />
            </label>

            {/* Santé du prêt : n'a de sens que sur un emprunt collatéralisé. */}
            {isDebtForm && (
              <>
                <label className="text-meta block">
                  Health factor
                  <input
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    placeholder="1.85"
                    value={form.healthFactor}
                    onChange={(e) => set("healthFactor", e.target.value)}
                    data-testid="defi-health-factor"
                  />
                </label>
                <label className="text-meta block">
                  LTV (%)
                  <input
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.ltvPct}
                    onChange={(e) => set("ltvPct", e.target.value)}
                  />
                </label>
              </>
            )}

            {!isDebtForm && (
              <label className="text-meta block">
                Récompenses à réclamer (€)
                <input
                  inputMode="decimal"
                  className="input mt-1 w-full"
                  value={form.rewardsValueEur}
                  onChange={(e) => set("rewardsValueEur", e.target.value)}
                />
              </label>
            )}
          </div>

          <p className="text-meta mt-2">
            {isDebtForm
              ? "Un emprunt est saisi en montant positif : il se retranche automatiquement du net DeFi."
              : "La valeur affichée viendra du journal, pas de cette saisie — le prix unitaire ne sert qu'à l'écriture d'entrée."}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              disabled={!canSubmit || create.isPending}
              onClick={() => create.mutate()}
              data-testid="defi-submit"
            >
              {create.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      )}

      {positions.length === 0 ? (
        <EmptyPlaceholder
          compact
          title="Aucune position DeFi"
          description="Synchronisez un wallet EVM ou ajoutez une position à la main (staking Solana, « earn » d'exchange…)."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "Déposé", value: num(summary?.depositedEur) },
              { label: "Emprunté", value: -num(summary?.borrowedEur) },
              { label: "Net DeFi", value: num(summary?.netEur), strong: true },
              {
                label: "Récompenses",
                value: num(summary?.pendingRewardsEur),
              },
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
                    k.strong ? "text-sm font-semibold" : "text-xs font-medium"
                  )}
                >
                  {formatCurrency(String(k.value), "EUR")}
                </p>
              </div>
            ))}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                APY moyen
              </p>
              <p className="mt-0.5 text-xs font-medium tabular-nums">
                {summary?.weightedApyPct
                  ? `${Number(summary.weightedApyPct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                  : "—"}
              </p>
            </div>
          </div>

          {/* Alerte de liquidation — au-dessus du tableau, jamais noyée dedans. */}
          {summary?.worstHealthFactor != null &&
            summary.worstHealthFactor < 1.8 && (
              <div
                className={cn(
                  "mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs",
                  riskClass(
                    summary.worstHealthFactor < 1.3 ? "CRITICAL" : "WARNING"
                  )
                )}
                data-testid="defi-health-alert"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Health factor le plus bas :{" "}
                  <strong className="tabular-nums">
                    {summary.worstHealthFactor.toLocaleString("fr-FR", {
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                  {summary.worstHealthFactor < 1.3
                    ? " — la position est proche du seuil de liquidation."
                    : " — surveillez le collatéral."}
                </span>
              </div>
            )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs" data-testid="defi-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="py-1.5 pr-2">Protocole</th>
                  <th className="py-1.5 pr-2">Nature</th>
                  <th className="py-1.5 pr-2">Actif</th>
                  <th className="py-1.5 pr-2 text-right">APY</th>
                  <th className="py-1.5 pr-2 text-right">Santé</th>
                  <th className="py-1.5 text-right">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--border)]/50"
                    data-testid="defi-row"
                  >
                    <td className="py-1.5 pr-2">
                      <span className="font-medium">{p.protocol}</span>
                      {p.chain && (
                        <span className="text-meta ml-1">· {p.chain}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 text-[10px]",
                          p.isDebt
                            ? "border-[var(--danger)]/40 text-[var(--danger)]"
                            : "border-[var(--border)] text-[var(--muted-foreground)]"
                        )}
                      >
                        {defiPositionTypeLabel(p.positionType)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2">{p.assetSymbol}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {p.apyPct
                        ? `${Number(p.apyPct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {p.healthFactor != null ? (
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[10px]",
                            riskClass(p.healthRisk)
                          )}
                        >
                          {p.healthFactor.toLocaleString("fr-FR", {
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 text-right font-medium tabular-nums",
                        p.isDebt && "text-[var(--danger)]"
                      )}
                    >
                      {formatCurrency(p.netValueEur, "EUR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-meta mt-3">
            Un emprunt est compté en négatif : le net DeFi est ce que les
            positions pèsent réellement, dettes déduites.
          </p>
        </>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Layers, Lock } from "lucide-react";
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
  /** Indicatif, LP uniquement — cf. impermanent-loss.ts. Absent si non calculable. */
  impermanentLossPct: string | null;
  impermanentLossEur: string | null;
  strategyId: string | null;
  /** Absent si la position n'a aucune contrainte de déblocage. */
  lock: {
    isLocked: boolean;
    vestedPct: string | null;
    nextUnlockAt: string | null;
  } | null;
};

type StrategyRow = {
  id: string;
  name: string;
  notes: string | null;
};

type StrategyGroupRow = {
  strategyId: string;
  name: string;
  depositedEur: string;
  borrowedEur: string;
  netEur: string;
  positionIds: string[];
};

/** Jeton au-delà du second, saisi pour une LP à 3-5 actifs (Curve, Balancer…). */
type ExtraLegForm = {
  symbol: string;
  amount: string;
  entryPriceEur: string;
  allocationPct: string;
};

function emptyExtraLeg(): ExtraLegForm {
  return { symbol: "", amount: "", entryPriceEur: "", allocationPct: "" };
}

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
  byStrategy: StrategyGroupRow[];
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
  strategyId: "",
  quantity: "",
  unitPriceEur: "",
  openedAt: new Date().toISOString().slice(0, 10),
  apyPct: "",
  rewardsValueEur: "",
  healthFactor: "",
  ltvPct: "",

  // LP uniquement — ignorés pour les autres natures de position.
  numberOfAssets: 2 as 2 | 3 | 4 | 5,
  pairedSymbol: "",
  pairedAmount: "",
  pairedEntryPriceEur: "",
  extraLegs: [] as ExtraLegForm[],
  isConcentrated: false,
  priceRangeMin: "",
  priceRangeMax: "",
  token1AllocationPct: "",
  pairedAllocationPct: "",
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
  const [groupByStrategyView, setGroupByStrategyView] = useState(false);
  const [newStrategyName, setNewStrategyName] = useState("");

  const q = useQuery({
    queryKey: ["crypto-defi"],
    queryFn: () => fetchJson<DefiResponse>("/api/crypto/defi"),
  });

  const platformsQ = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fetchJson<{ platforms: PlatformRow[] }>("/api/platforms"),
  });

  const strategiesQ = useQuery({
    queryKey: ["crypto-defi-strategies"],
    queryFn: () =>
      fetchJson<{ strategies: StrategyRow[] }>("/api/crypto/defi/strategies"),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crypto-defi"] });
    // La position pèse au patrimoine : la vue Positions doit suivre.
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
  };

  const createStrategy = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/crypto/defi/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Création impossible");
      return json as StrategyRow;
    },
    onSuccess: (strategy) => {
      setForm((f) => ({ ...f, strategyId: strategy.id }));
      setNewStrategyName("");
      void qc.invalidateQueries({ queryKey: ["crypto-defi-strategies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      const isLp = form.positionType === "LP";
      const res = await fetch("/api/crypto/defi/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId: form.platformId,
          assetSymbol: form.assetSymbol,
          protocol: form.protocol,
          positionType: form.positionType,
          quantity: form.quantity,
          unitPriceEur: form.unitPriceEur,
          openedAt: form.openedAt,
          chain: form.chain || null,
          strategyId: form.strategyId || null,
          apyPct: form.apyPct || null,
          rewardsValueEur: form.rewardsValueEur || null,
          healthFactor: form.healthFactor || null,
          ltvPct: form.ltvPct || null,
          ...(isLp
            ? {
                pairedSymbol: form.pairedSymbol,
                pairedAmount: form.pairedAmount,
                pairedEntryPriceEur: form.pairedEntryPriceEur,
                extraLegs: form.extraLegs
                  .slice(0, form.numberOfAssets - 2)
                  .map((l) => ({
                    symbol: l.symbol,
                    amount: l.amount,
                    entryPriceEur: l.entryPriceEur,
                    allocationPct: l.allocationPct || null,
                  })),
                isConcentrated: form.isConcentrated,
                priceRangeMin: form.isConcentrated ? form.priceRangeMin : null,
                priceRangeMax: form.isConcentrated ? form.priceRangeMax : null,
                token1AllocationPct: form.isConcentrated
                  ? form.token1AllocationPct || null
                  : null,
                pairedAllocationPct: form.isConcentrated
                  ? form.pairedAllocationPct || null
                  : null,
              }
            : {}),
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
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setExtraLeg = (
    index: number,
    patch: Partial<ExtraLegForm>
  ) =>
    setForm((f) => {
      const legs = [...f.extraLegs];
      while (legs.length <= index) legs.push(emptyExtraLeg());
      legs[index] = { ...legs[index]!, ...patch };
      return { ...f, extraLegs: legs };
    });

  const setNumberOfAssets = (n: 2 | 3 | 4 | 5) =>
    setForm((f) => {
      const legs = [...f.extraLegs];
      const needed = Math.max(0, n - 2);
      while (legs.length < needed) legs.push(emptyExtraLeg());
      return { ...f, numberOfAssets: n, extraLegs: legs.slice(0, needed) };
    });

  const isDebtForm = isDebtPosition(form.positionType);
  const isLpForm = form.positionType === "LP";
  const activeExtraLegs = form.extraLegs.slice(0, form.numberOfAssets - 2);

  const canSubmit =
    form.platformId &&
    form.assetSymbol.trim() &&
    form.protocol.trim() &&
    form.quantity &&
    form.unitPriceEur &&
    (!isLpForm ||
      (form.pairedSymbol.trim() &&
        form.pairedAmount &&
        form.pairedEntryPriceEur &&
        activeExtraLegs.every(
          (l) => l.symbol.trim() && l.amount && l.entryPriceEur
        ) &&
        (!form.isConcentrated || (form.priceRangeMin && form.priceRangeMax))));

  if (q.isPending) {
    return <Skeleton className={cn("h-64 w-full", className)} />;
  }

  return (
    <section className={cn("card p-4", className)} data-testid="crypto-defi-panel">
      <PanelHeader
        title="Positions DeFi"
        subtitle="Staking, prêts, emprunts et liquidité — valeur issue du journal"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1 text-[11px] font-medium transition",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                groupByStrategyView
                  ? "border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
              aria-expanded={groupByStrategyView}
              data-testid="defi-strategy-view-toggle"
              onClick={() => setGroupByStrategyView((v) => !v)}
            >
              <Layers className="h-3 w-3" aria-hidden />
              Par stratégie
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  groupByStrategyView && "rotate-180"
                )}
                aria-hidden
              />
            </button>
            <Button
              type="button"
              variant={showForm ? "outline" : "default"}
              onClick={() => setShowForm((v) => !v)}
              data-testid="defi-form-toggle"
            >
              {showForm ? "Annuler" : "Ajouter une position"}
            </Button>
          </div>
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
              Stratégie (optionnel)
              <select
                className="input mt-1 w-full"
                value={form.strategyId}
                onChange={(e) => set("strategyId", e.target.value)}
                data-testid="defi-strategy-select"
              >
                <option value="">— autonome —</option>
                {(strategiesQ.data?.strategies ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="mt-1 flex gap-1.5">
                <input
                  className="input w-full"
                  placeholder="Nouvelle stratégie…"
                  value={newStrategyName}
                  onChange={(e) => setNewStrategyName(e.target.value)}
                  data-testid="defi-strategy-new-name"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!newStrategyName.trim() || createStrategy.isPending}
                  onClick={() => createStrategy.mutate(newStrategyName.trim())}
                  data-testid="defi-strategy-new-submit"
                >
                  +
                </Button>
              </div>
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

          {isLpForm && (
            <div
              className="mt-3 space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-3"
              data-testid="defi-lp-section"
            >
              <div>
                <span className="text-meta block">Nombre d&apos;actifs de la LP</span>
                <div className="mt-1 flex gap-1.5" role="group" aria-label="Nombre d'actifs">
                  {([2, 3, 4, 5] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNumberOfAssets(n)}
                      aria-pressed={form.numberOfAssets === n}
                      data-testid={`defi-lp-nassets-${n}`}
                      className={cn(
                        "rounded-md border px-3 py-1 text-xs font-medium transition",
                        form.numberOfAssets === n
                          ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-meta block">
                  Jeton 2 (second actif)
                  <input
                    className="input mt-1 w-full"
                    placeholder="USDC"
                    value={form.pairedSymbol}
                    onChange={(e) => set("pairedSymbol", e.target.value)}
                    data-testid="defi-lp-token2-symbol"
                  />
                </label>
                <label className="text-meta block">
                  Quantité jeton 2
                  <input
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.pairedAmount}
                    onChange={(e) => set("pairedAmount", e.target.value)}
                    data-testid="defi-lp-token2-amount"
                  />
                </label>
                <label className="text-meta block">
                  Prix d&apos;entrée jeton 2 (€)
                  <input
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.pairedEntryPriceEur}
                    onChange={(e) => set("pairedEntryPriceEur", e.target.value)}
                    data-testid="defi-lp-token2-entry"
                  />
                </label>

                {activeExtraLegs.map((leg, i) => (
                  <div key={i} className="contents">
                    <label className="text-meta block">
                      Jeton {i + 3}
                      <input
                        className="input mt-1 w-full"
                        value={leg.symbol}
                        onChange={(e) => setExtraLeg(i, { symbol: e.target.value })}
                        data-testid={`defi-lp-token${i + 3}-symbol`}
                      />
                    </label>
                    <label className="text-meta block">
                      Quantité jeton {i + 3}
                      <input
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        value={leg.amount}
                        onChange={(e) => setExtraLeg(i, { amount: e.target.value })}
                        data-testid={`defi-lp-token${i + 3}-amount`}
                      />
                    </label>
                    <label className="text-meta block">
                      Prix d&apos;entrée jeton {i + 3} (€)
                      <input
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        value={leg.entryPriceEur}
                        onChange={(e) => setExtraLeg(i, { entryPriceEur: e.target.value })}
                        data-testid={`defi-lp-token${i + 3}-entry`}
                      />
                    </label>
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-meta">
                <input
                  type="checkbox"
                  checked={form.isConcentrated}
                  onChange={(e) => set("isConcentrated", e.target.checked)}
                  data-testid="defi-lp-concentrated"
                />
                Liquidité concentrée (plage de prix, type Uniswap V3 / Curve)
              </label>

              {form.isConcentrated && (
                <div className="space-y-2 rounded-[var(--radius-md)] bg-[var(--muted)]/30 p-2.5">
                  <p className="text-meta">
                    La plage définit l&apos;intervalle où la position génère des frais.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-meta block">
                      Prix min
                      <input
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        placeholder="0.0001"
                        value={form.priceRangeMin}
                        onChange={(e) => set("priceRangeMin", e.target.value)}
                        data-testid="defi-lp-range-min"
                      />
                    </label>
                    <label className="text-meta block">
                      Prix max
                      <input
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        placeholder="2.5"
                        value={form.priceRangeMax}
                        onChange={(e) => set("priceRangeMax", e.target.value)}
                        data-testid="defi-lp-range-max"
                      />
                    </label>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="text-meta block">
                      % jeton 1
                      <input
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        value={form.token1AllocationPct}
                        onChange={(e) => set("token1AllocationPct", e.target.value)}
                        data-testid="defi-lp-alloc-1"
                      />
                    </label>
                    <label className="text-meta block">
                      % jeton 2
                      <input
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        value={form.pairedAllocationPct}
                        onChange={(e) => set("pairedAllocationPct", e.target.value)}
                        data-testid="defi-lp-alloc-2"
                      />
                    </label>
                    {activeExtraLegs.map((leg, i) => (
                      <label key={i} className="text-meta block">
                        % jeton {i + 3}
                        <input
                          inputMode="decimal"
                          className="input mt-1 w-full"
                          value={leg.allocationPct}
                          onChange={(e) =>
                            setExtraLeg(i, { allocationPct: e.target.value })
                          }
                          data-testid={`defi-lp-alloc-${i + 3}`}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-meta">
                    Laissez tout vide pour une répartition égale implicite, ou
                    renseignez les {form.numberOfAssets} champs — la somme doit
                    faire 100 %.
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="text-meta mt-2">
            {isDebtForm
              ? "Un emprunt est saisi en montant positif : il se retranche automatiquement du net DeFi."
              : isLpForm
                ? "La valeur affichée viendra du journal pour le premier jeton ; les suivants ne servent qu'au calcul de l'impermanent loss."
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
                  <th className="py-1.5 pr-2 text-right">IL</th>
                  <th className="py-1.5 pr-2 text-right">Lock</th>
                  <th className="py-1.5 text-right">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {groupByStrategyView && (
                  <>
                    {(q.data?.byStrategy ?? []).map((g) => (
                      <StrategyGroupRows
                        key={g.strategyId}
                        group={g}
                        positions={positions}
                      />
                    ))}
                    {(() => {
                      const grouped = new Set(
                        (q.data?.byStrategy ?? []).flatMap((g) => g.positionIds)
                      );
                      const rest = positions.filter((p) => !grouped.has(p.id));
                      if (rest.length === 0) return null;
                      return (
                        <>
                          <tr className="bg-[var(--muted)]/20">
                            <td
                              colSpan={8}
                              className="py-1 pl-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]"
                            >
                              Sans stratégie
                            </td>
                          </tr>
                          {rest.map((p) => (
                            <PositionRowView key={p.id} p={p} />
                          ))}
                        </>
                      );
                    })()}
                  </>
                )}
                {!groupByStrategyView &&
                  positions.map((p) => <PositionRowView key={p.id} p={p} />)}
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

function PositionRowView({ p }: { p: PositionRow }) {
  return (
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
                      className="py-1.5 pr-2 text-right tabular-nums"
                      data-testid="defi-row-il"
                    >
                      {p.positionType !== "LP" ? (
                        "—"
                      ) : p.impermanentLossPct != null ? (
                        <span
                          className={cn(
                            "font-medium",
                            Number(p.impermanentLossPct) < 0
                              ? "text-[var(--danger)]"
                              : "text-[var(--success)]"
                          )}
                          title={
                            p.impermanentLossEur != null
                              ? formatCurrency(p.impermanentLossEur, "EUR")
                              : undefined
                          }
                        >
                          {Number(p.impermanentLossPct).toLocaleString("fr-FR", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          %
                        </span>
                      ) : (
                        <span className="text-[var(--muted-foreground)]" title="Prix courant indisponible pour au moins un jeton">
                          indisponible
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right" data-testid="defi-row-lock">
                      {p.lock ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                            p.lock.isLocked
                              ? "border-[var(--warning)]/40 text-[var(--warning)]"
                              : "border-[var(--border)] text-[var(--muted-foreground)]"
                          )}
                          title={
                            p.lock.nextUnlockAt
                              ? `Déblocage : ${new Date(p.lock.nextUnlockAt).toLocaleDateString("fr-FR")}`
                              : undefined
                          }
                        >
                          <Lock className="h-3 w-3" aria-hidden />
                          {p.lock.vestedPct != null
                            ? `${Number(p.lock.vestedPct).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`
                            : p.lock.isLocked
                              ? "verrouillé"
                              : "débloqué"}
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
  );
}

function StrategyGroupRows({
  group,
  positions,
}: {
  group: StrategyGroupRow;
  positions: PositionRow[];
}) {
  const rows = positions.filter((p) => group.positionIds.includes(p.id));
  if (rows.length === 0) return null;
  return (
    <>
      <tr className="bg-[var(--muted)]/20" data-testid="defi-strategy-group-header">
        <td
          colSpan={8}
          className="py-1 pl-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]"
        >
          {group.name}
          <span className="ml-2 font-normal normal-case tabular-nums">
            net {formatCurrency(group.netEur, "EUR")}
          </span>
        </td>
      </tr>
      {rows.map((p) => (
        <PositionRowView key={p.id} p={p} />
      ))}
    </>
  );
}

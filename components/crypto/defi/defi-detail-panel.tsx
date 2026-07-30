"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field, FormSection } from "@/components/ui/field";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import { defiPositionTypeLabel } from "@/app/lib/crypto/constants";
import {
  getDefiAvailableActions,
  getDefiLockInfo,
  getDefiStatusBadges,
  getDefiValuationDisplay,
  type ClientDefiPosition,
  type DefiActionId,
} from "@/app/lib/crypto/defi-ui-rules";
import { DefiBadgeList } from "./defi-badges";

type DetailResponse = {
  position: ClientDefiPosition;
  conflicts: Array<{ kind: string; keepId: string; duplicateId: string; reason: string }>;
  events: Array<{
    id: string;
    eventType: string;
    eventDate: string;
    chainId: string | null;
    txHash: string | null;
    symbol: string | null;
    quantity: string | null;
    amountEur: string | null;
    feesEur: string | null;
    relatedProtocol: string | null;
    ledgerTransactionId: string | null;
    sourceProvider: string;
  }>;
  valuations: Array<{
    id: string;
    valuationDate: string;
    valuationMethod: string;
    sourceProvider: string;
    grossValueEur: string | null;
    netValueEur: string | null;
    debtValueEur: string | null;
    retainedValueEur: string | null;
    confidenceScore: number | null;
    isManual: boolean;
    fallbackReason: string | null;
  }>;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: "Dépôt",
  WITHDRAW: "Retrait",
  STAKE: "Staking",
  UNSTAKE: "Déblocage",
  CLAIM_REWARD: "Réclamation",
  COMPOUND: "Capitalisation",
  BORROW: "Emprunt",
  REPAY: "Remboursement",
  ADD_LIQUIDITY: "Ajout de liquidité",
  REMOVE_LIQUIDITY: "Retrait de liquidité",
  REBALANCE: "Rééquilibrage",
  MIGRATE: "Migration",
  LIQUIDATION: "Liquidation",
  BRIDGE_IN: "Arrivée de pont",
  BRIDGE_OUT: "Départ de pont",
  WRAP: "Encapsulation",
  UNWRAP: "Désencapsulation",
  SYNC_REFRESH: "Synchronisation",
  MANUAL_OVERRIDE: "Correction manuelle",
};

/**
 * Panneau détail d'une position DeFi — 9 sections, dans l'ordre du cahier des
 * charges. Chaque nombre affiché vient de `position.valuation`, jamais
 * recalculé ici : un second calcul divergerait tôt ou tard du tableau.
 */
export function DefiDetailPanel({
  positionId,
  onClose,
  onChanged,
}: {
  positionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<DefiActionId | null>(null);
  const [editing, setEditing] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [manualReason, setManualReason] = useState("");

  const q = useQuery({
    queryKey: ["crypto-defi-position", positionId],
    queryFn: () => fetchJson<DetailResponse>(`/api/crypto/defi/positions/${positionId}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crypto-defi-portfolio"] });
    void qc.invalidateQueries({ queryKey: ["crypto-defi-position", positionId] });
    onChanged();
  };

  const flags = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/crypto/defi/positions/${positionId}/flags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const closePosition = useMutation({
    mutationFn: (opts: { assetId: string; liquidated: boolean }) =>
      fetchJson("/api/crypto/defi/positions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: opts.assetId, liquidated: opts.liquidated }),
      }),
    onSuccess: (_data, vars) => {
      toast.success(vars.liquidated ? "Position marquée comme liquidée" : "Position clôturée");
      invalidate();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overrideValuation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/crypto/defi/positions/${positionId}/valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grossValueEur: manualValue, reason: manualReason || null }),
      }),
    onSuccess: () => {
      toast.success("Valorisation manuelle enregistrée");
      setOverriding(false);
      setManualValue("");
      setManualReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearManualValuation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/crypto/defi/positions/${positionId}/valuation`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Valorisation manuelle retirée — la position repasse au calcul automatique");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshValuations = useMutation({
    mutationFn: () => fetchJson("/api/crypto/defi/valuations/refresh", { method: "POST" }),
    onSuccess: () => {
      toast.success("Valorisations rafraîchies pour l'ensemble du portefeuille DeFi");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/crypto/defi/positions/${positionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Position mise à jour");
      setEditing(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isPending) {
    return (
      <Modal title="Position DeFi" onClose={onClose} panelClassName="w-[min(52rem,calc(100vw-2rem))] max-w-[52rem]">
        <p className="text-meta">Chargement…</p>
      </Modal>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Modal title="Position DeFi" onClose={onClose} panelClassName="w-[min(52rem,calc(100vw-2rem))] max-w-[52rem]">
        <p className="text-sm text-[var(--danger)]">
          Impossible de charger cette position — elle a peut-être été supprimée.
        </p>
      </Modal>
    );
  }

  const { position: p, events, valuations } = q.data;
  const badges = getDefiStatusBadges(p);
  const valuationDisplay = getDefiValuationDisplay(p);
  const lock = getDefiLockInfo(p);
  const actions = getDefiAvailableActions(p);
  const isBorrowing = p.debt != null;

  function runAction(id: DefiActionId) {
    switch (id) {
      case "hide":
        flags.mutate({ isHidden: true });
        return;
      case "unhide":
        flags.mutate({ isHidden: false });
        return;
      case "ignore":
        flags.mutate({ isIgnoredInPortfolio: true });
        return;
      case "unignore":
        flags.mutate({ isIgnoredInPortfolio: false });
        return;
      case "clear-conflict":
        flags.mutate({ clearConflict: true });
        return;
      case "override-valuation":
        setOverriding(true);
        return;
      case "clear-manual-valuation":
        clearManualValuation.mutate();
        return;
      case "refresh-valuation":
        refreshValuations.mutate();
        return;
      case "edit":
        setEditing((v) => !v);
        return;
      case "close":
      case "liquidate":
        setConfirmAction(id);
        return;
      case "view-history":
        document.getElementById(`defi-detail-history-${positionId}`)?.scrollIntoView({
          behavior: "smooth",
        });
        return;
    }
  }

  return (
    <>
      <Modal
        title={p.assetName}
        onClose={onClose}
        panelClassName="w-[min(56rem,calc(100vw-2rem))] max-w-[56rem]"
        testId="defi-detail-panel"
      >
        <div className="space-y-4" data-testid="defi-detail-body">
          {/* 1. En-tête synthétique */}
          <section data-testid="defi-detail-header">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="text-meta">{defiPositionTypeLabel(p.positionType)}</p>
                <p className="text-2xl font-semibold tabular-nums" data-testid="defi-detail-retained">
                  {formatCurrency(p.valuation.retainedEur, "EUR")}
                </p>
              </div>
              <DefiBadgeList badges={badges} />
            </div>
          </section>

          {/* 2. Valorisation */}
          <FormSection title="Valorisation" step={2}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <ValueTile label="Brute" value={p.valuation.grossEur} hint={valuationDisplay.grossLabel} />
              <ValueTile label="Nette" value={p.valuation.netEur} hint={valuationDisplay.netLabel} />
              <ValueTile
                label="Retenue"
                value={p.valuation.retainedEur}
                hint={valuationDisplay.retainedLabel}
                strong
              />
              <ValueTile label="Dette" value={p.valuation.debtEur} hint={valuationDisplay.debtLabel} />
              <ValueTile
                label="Collatéral"
                value={p.valuation.collateralEur}
                hint={valuationDisplay.collateralLabel}
              />
              <ValueTile
                label="Rewards"
                value={p.valuation.rewardsEur}
                hint={valuationDisplay.rewardsLabel}
              />
            </div>
            <p className="text-meta mt-2">
              Méthode : <strong>{valuationDisplay.methodLabel}</strong>
              {p.valuation.lastValuationAt
                ? ` · dernière valorisation : ${formatDate(p.valuation.lastValuationAt)}`
                : " · jamais valorisée"}
              {valuationDisplay.isStale ? " · périmée" : ""}
            </p>
            {!valuationDisplay.isValuable || p.valuation.fallbackReason ? (
              <p className="text-meta mt-1 text-[var(--warning)]">{valuationDisplay.explanation}</p>
            ) : null}

            {overriding ? (
              <div className="mt-2 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2.5">
                <Field label="Valeur brute (€)" htmlFor="defi-manual-value">
                  <input
                    id="defi-manual-value"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                    data-testid="defi-detail-manual-value"
                  />
                </Field>
                <Field label="Raison" htmlFor="defi-manual-reason" optional>
                  <input
                    id="defi-manual-reason"
                    className="input mt-1 w-full"
                    placeholder="Vault opaque, jeton non coté…"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    data-testid="defi-detail-manual-reason"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!manualValue || overrideValuation.isPending}
                    onClick={() => overrideValuation.mutate()}
                    data-testid="defi-detail-manual-submit"
                  >
                    Enregistrer
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setOverriding(false)}>
                    Annuler
                  </Button>
                </div>
              </div>
            ) : null}
          </FormSection>

          {/* 3. Exposition économique */}
          <FormSection title="Exposition économique" step={3}>
            {p.legs.length === 0 ? (
              <p className="text-meta">
                {p.assetSymbol} · quantité portée par le journal.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {p.legs.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{l.symbol}</span>
                      <span className="text-meta ml-1.5">{legTypeLabel(l.legType)}</span>
                      {!l.isActive && <span className="text-meta ml-1.5">(soldée)</span>}
                    </span>
                    <span className="tabular-nums">
                      {l.quantity}
                      {l.valueEur ? ` · ${formatCurrency(l.valueEur, "EUR")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {p.isConcentrated && (
              <p className="text-meta mt-2">
                Liquidité concentrée
                {p.priceRangeMin && p.priceRangeMax
                  ? ` — plage [${p.priceRangeMin} ; ${p.priceRangeMax}]`
                  : ""}
                . Statut in-range non calculé (nécessite un prix de marché en temps réel).
              </p>
            )}
          </FormSection>

          {/* 4. Infrastructure */}
          <FormSection title="Infrastructure" step={4}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <Dt label="Chaîne" value={p.chain ?? "—"} />
              <Dt label="Protocole" value={p.protocol || "Non divulgué"} />
              <Dt label="Version" value={p.protocolVersion ?? "—"} />
              <Dt label="Marché" value={p.marketRef ?? "—"} />
              <Dt label="Vault / stratégie" value={p.vaultRef ?? "—"} />
              <Dt label="Pool" value={p.poolRef ?? "—"} />
              <Dt label="Validateur" value={p.validatorName ?? "—"} />
              <Dt
                label="Protocole sous-jacent"
                value={p.underlyingProtocol ?? "—"}
              />
              <Dt label="Wallet / plateforme" value={p.platformName} />
            </dl>
          </FormSection>

          {/* 5. Rendement / rewards */}
          <FormSection title="Rendement / rewards" step={5}>
            <p className="text-meta">
              APR/APY indicatif : <strong>{p.apyPct ? `${p.apyPct} %` : "—"}</strong> — jamais
              une valeur comptable.
            </p>
            {p.rewards.length === 0 ? (
              <p className="text-meta mt-1">Aucune récompense suivie.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-xs">
                {p.rewards.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{r.symbol}</span>
                      <span className="text-meta ml-1.5">{rewardTypeLabel(r.rewardType)}</span>
                    </span>
                    <span className="tabular-nums">
                      accru {r.accruedQuantity ?? "0"}
                      {r.claimedQuantity ? ` · réclamé ${r.claimedQuantity}` : ""}
                      {r.isValuable && r.valueEur ? ` · ${formatCurrency(r.valueEur, "EUR")}` : " · hors valorisation"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          {/* 6. Risque / liquidité / statut */}
          <FormSection title="Risque / liquidité / statut" step={6}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <Dt label="Statut" value={p.status} />
              <Dt label="Liquide" value={p.isLiquid ? "Oui" : "Non"} />
              <Dt label="Verrouillage" value={lock.isLocked ? `Jusqu'au ${lock.unlockAt}` : "Aucun"} />
              {isBorrowing && (
                <>
                  <Dt label="LTV" value={p.debt?.ltvPct ? `${p.debt.ltvPct} %` : "—"} />
                  <Dt label="Health factor" value={p.debt?.healthFactor ?? "—"} />
                  <Dt label="Seuil de liquidation" value={p.debt?.liqThresholdPct ? `${p.debt.liqThresholdPct} %` : "—"} />
                </>
              )}
              <Dt label="Ouverte le" value={p.openedAt ? formatDate(p.openedAt) : "—"} />
              {p.closedAt && <Dt label="Clôturée le" value={formatDate(p.closedAt)} />}
            </dl>
          </FormSection>

          {/* 7. Historique / événements */}
          <FormSection title="Historique / événements" step={7}>
            <div id={`defi-detail-history-${positionId}`}>
              {events.length === 0 ? (
                <p className="text-meta">Aucun événement enregistré.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs" data-testid="defi-detail-events">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 border-b border-[var(--border)]/40 pb-1">
                      <span>
                        <span className="font-medium">{EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}</span>
                        {e.symbol && <span className="text-meta ml-1.5">{e.symbol}</span>}
                      </span>
                      <span className="text-meta tabular-nums">{formatDate(e.eventDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FormSection>

          {/* 8. Sync / providers */}
          <FormSection title="Sync / providers" step={8}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <Dt label="Origine" value={p.dataOrigin === "MANUAL" ? "Saisie manuelle" : p.dataOrigin} />
              <Dt
                label="Dernière valorisation datée"
                value={
                  valuations[0]
                    ? `${formatDate(valuations[0].valuationDate)} (${valuations[0].valuationMethod})`
                    : "—"
                }
              />
              <Dt label="Événements enregistrés" value={String(p.eventCount)} />
            </dl>
          </FormSection>

          {/* 9. Actions */}
          <FormSection title="Actions" step={9}>
            {editing ? (
              <EditPositionForm
                position={p}
                pending={edit.isPending}
                onCancel={() => setEditing(false)}
                onSave={(body) => edit.mutate(body)}
              />
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="defi-detail-actions">
                {actions.map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    variant={a.danger ? "danger" : "outline"}
                    size="sm"
                    onClick={() => runAction(a.id)}
                    data-testid={`defi-detail-action-${a.id}`}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </FormSection>
        </div>
      </Modal>

      {confirmAction === "close" && (
        <ConfirmDialog
          open
          title="Clôturer la position"
          message="La position sera ramenée à zéro par une écriture de sortie. L'historique reste consultable."
          confirmLabel="Clôturer"
          danger={false}
          onConfirm={() => {
            closePosition.mutate({ assetId: p.assetId, liquidated: false });
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
          testId="defi-confirm-close"
        />
      )}
      {confirmAction === "liquidate" && (
        <ConfirmDialog
          open
          title="Marquer comme liquidée"
          message="La position sera ramenée à zéro et signalée comme liquidée plutôt que clôturée volontairement — cette distinction reste dans l'historique."
          confirmLabel="Marquer comme liquidée"
          danger
          onConfirm={() => {
            closePosition.mutate({ assetId: p.assetId, liquidated: true });
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
          testId="defi-confirm-liquidate"
        />
      )}
    </>
  );
}

function ValueTile({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2",
        strong && "bg-[var(--muted)]/40"
      )}
      title={hint}
    >
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className={cn("mt-0.5 tabular-nums", strong ? "text-sm font-semibold" : "text-xs font-medium")}>
        {formatCurrency(value, "EUR")}
      </p>
    </div>
  );
}

function Dt({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function legTypeLabel(t: string): string {
  const labels: Record<string, string> = {
    ASSET: "actif déposé",
    COLLATERAL: "collatéral",
    DEBT: "dette",
    RECEIPT: "jeton de reçu",
    REWARD: "récompense",
    SHARE: "part",
    UNDERLYING: "sous-jacent",
  };
  return labels[t] ?? t;
}

function rewardTypeLabel(t: string): string {
  const labels: Record<string, string> = {
    YIELD: "rendement",
    TRADING_FEES: "frais de trading",
    EMISSIONS: "émissions",
    AIRDROP: "airdrop",
    POINTS: "points",
    COUPON: "coupon",
    OTHER: "autre",
  };
  return labels[t] ?? t;
}

/** Édition des champs de contexte — jamais la quantité ni le prix, qui appartiennent au journal. */
function EditPositionForm({
  position: p,
  pending,
  onSave,
  onCancel,
}: {
  position: ClientDefiPosition;
  pending: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [ownerLabel, setOwnerLabel] = useState(p.ownerLabel ?? "");
  const [ownershipPct, setOwnershipPct] = useState(p.ownershipPct ?? "100");
  const [protocol, setProtocol] = useState(p.protocol);
  const [chain, setChain] = useState(p.chain ?? "");
  const [apyPct, setApyPct] = useState(p.apyPct ?? "");
  const [healthFactor, setHealthFactor] = useState(p.debt?.reportedHealthFactor ?? "");
  const [ltvPct, setLtvPct] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="defi-edit-form">
      <Field label="Détenteur" htmlFor="defi-edit-owner" optional>
        <input
          id="defi-edit-owner"
          className="input mt-1 w-full"
          value={ownerLabel}
          onChange={(e) => setOwnerLabel(e.target.value)}
        />
      </Field>
      <Field label="Quote-part (%)" htmlFor="defi-edit-ownership">
        <input
          id="defi-edit-ownership"
          inputMode="decimal"
          className="input mt-1 w-full"
          value={ownershipPct}
          onChange={(e) => setOwnershipPct(e.target.value)}
        />
      </Field>
      <Field label="Protocole" htmlFor="defi-edit-protocol" optional>
        <input
          id="defi-edit-protocol"
          className="input mt-1 w-full"
          value={protocol}
          onChange={(e) => setProtocol(e.target.value)}
        />
      </Field>
      <Field label="Chaîne" htmlFor="defi-edit-chain" optional>
        <input
          id="defi-edit-chain"
          className="input mt-1 w-full"
          value={chain}
          onChange={(e) => setChain(e.target.value)}
        />
      </Field>
      <Field label="APY (%)" htmlFor="defi-edit-apy" optional>
        <input
          id="defi-edit-apy"
          inputMode="decimal"
          className="input mt-1 w-full"
          value={apyPct}
          onChange={(e) => setApyPct(e.target.value)}
        />
      </Field>
      {p.debt && (
        <>
          <Field label="Health factor" htmlFor="defi-edit-hf" optional>
            <input
              id="defi-edit-hf"
              inputMode="decimal"
              className="input mt-1 w-full"
              value={healthFactor}
              onChange={(e) => setHealthFactor(e.target.value)}
            />
          </Field>
          <Field label="LTV (%)" htmlFor="defi-edit-ltv" optional>
            <input
              id="defi-edit-ltv"
              inputMode="decimal"
              className="input mt-1 w-full"
              value={ltvPct}
              onChange={(e) => setLtvPct(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field label="Notes" htmlFor="defi-edit-notes" optional className="sm:col-span-2 lg:col-span-3">
        <textarea
          id="defi-edit-notes"
          className="input mt-1 w-full"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            onSave({
              ownerLabel: ownerLabel || null,
              ownershipPct: ownershipPct || null,
              protocol: protocol || undefined,
              chain: chain || null,
              apyPct: apyPct || null,
              ...(p.debt
                ? { healthFactor: healthFactor || null, ltvPct: ltvPct || null }
                : {}),
              notes: notes || null,
            })
          }
          data-testid="defi-edit-submit"
        >
          Enregistrer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}


"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageOff } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field, FormSection } from "@/components/ui/field";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import { formatDateTimeParis } from "@/app/lib/money/format";
import { NFT_EVENT_TYPES, NFT_DISPOSAL_SOURCES } from "@/app/lib/crypto/nft-taxonomy";
import {
  getNftAcquisitionCostDisplay,
  getNftAvailableActions,
  getNftStatusBadges,
  getNftValuationDisplay,
  nftChainLabel,
  nftHoldingStatusLabel,
  nftValuationMethodLabel,
  NFT_STANDARDS,
  type ClientNftHolding,
  type NftActionId,
} from "@/app/lib/crypto/nft-ui-rules";
import { NftBadgeList } from "./nft-badges";

type DetailResponse = {
  position: ClientNftHolding;
  conflicts: Array<{ kind: string; keepId: string; duplicateId: string; reason: string }>;
  events: Array<{
    id: string;
    eventType: string;
    eventDate: string;
    chainId: string | null;
    txHash: string | null;
    fromAddress: string | null;
    toAddress: string | null;
    marketplace: string | null;
    quantity: string | null;
    priceEur: string | null;
    feesEur: string | null;
    royaltyEur: string | null;
    ledgerTransactionId: string | null;
    sourceProvider: string;
  }>;
  valuations: Array<{
    id: string;
    valuationDate: string;
    valuationMethod: string;
    sourceProvider: string;
    amountEur: string | null;
    floorPriceEur: string | null;
    lastSaleEur: string | null;
    appraisedValueEur: string | null;
    confidenceScore: number | null;
    isManual: boolean;
    fallbackReason: string | null;
  }>;
  traits: Array<{ traitType: string; value: string; rarityPct: string | null }>;
};

/**
 * Panneau détail d'un NFT — 9 sections, dans l'ordre du cahier des charges
 * G2. Chaque montant vient de `position` ou de `valuations[0]`, jamais
 * recalculé ici — un second calcul divergerait tôt ou tard de la galerie.
 */
export function NftDetailPanel({
  assetId,
  onClose,
  onChanged,
}: {
  assetId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<NftActionId | null>(null);
  const [disposing, setDisposing] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [appraisalValue, setAppraisalValue] = useState("");
  const [appraisalReason, setAppraisalReason] = useState("");

  const q = useQuery({
    queryKey: ["crypto-nft-position", assetId],
    queryFn: () => fetchJson<DetailResponse>(`/api/crypto/nft/positions/${assetId}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crypto-nft-portfolio"] });
    void qc.invalidateQueries({ queryKey: ["crypto-nft-position", assetId] });
    onChanged();
  };

  const flags = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/crypto/nft/positions/${assetId}/flags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const dispose = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/crypto/nft/positions/${assetId}/dispose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("NFT sorti du patrimoine actif — historique conservé");
      setDisposing(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overrideValuation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/crypto/nft/positions/${assetId}/valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountEur: appraisalValue, reason: appraisalReason || null }),
      }),
    onSuccess: () => {
      toast.success("Expertise manuelle enregistrée");
      setOverriding(false);
      setAppraisalValue("");
      setAppraisalReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearManualValuation = useMutation({
    mutationFn: () => fetchJson(`/api/crypto/nft/positions/${assetId}/valuation`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Expertise manuelle retirée — retour au calcul automatique");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshValuation = useMutation({
    mutationFn: () =>
      fetchJson("/api/crypto/nft/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [assetId] }),
      }),
    onSuccess: () => {
      toast.success("Rafraîchissement de la valorisation lancé");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isPending) {
    return (
      <Modal title="NFT" onClose={onClose} panelClassName="w-[min(56rem,calc(100vw-2rem))] max-w-[56rem]">
        <p className="text-meta">Chargement…</p>
      </Modal>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Modal title="NFT" onClose={onClose} panelClassName="w-[min(56rem,calc(100vw-2rem))] max-w-[56rem]">
        <p className="text-sm text-[var(--danger)]">
          Impossible de charger ce NFT — il a peut-être été supprimé.
        </p>
      </Modal>
    );
  }

  const { position: h, events, valuations, traits } = q.data;
  const badges = getNftStatusBadges(h);
  const valuationDisplay = getNftValuationDisplay(h);
  const actions = getNftAvailableActions(h);
  const latestValuation = valuations[0];
  const acquisitionDisplay = getNftAcquisitionCostDisplay(h);

  function runAction(id: NftActionId) {
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
      case "mark-spam":
        flags.mutate({ reclassify: { isSpam: true, isScamSuspected: true, reason: "Requalifié manuellement depuis le détail" } });
        return;
      case "unmark-spam":
        flags.mutate({ reclassify: { isSpam: false, isScamSuspected: false, reason: "Requalifié manuellement depuis le détail" } });
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
        refreshValuation.mutate();
        return;
      case "edit":
        return; // géré inline plus bas
      case "dispose":
        setConfirmAction(id);
        return;
      case "view-history":
        document.getElementById(`nft-detail-history-${assetId}`)?.scrollIntoView({ behavior: "smooth" });
        return;
    }
  }

  return (
    <>
      <Modal
        title={h.name}
        onClose={onClose}
        panelClassName="w-[min(56rem,calc(100vw-2rem))] max-w-[56rem]"
        testId="nft-detail-panel"
      >
        <div className="space-y-4" data-testid="nft-detail-body">
          {/* 1. En-tête */}
          <section data-testid="nft-detail-header">
            <div className="flex flex-wrap items-start gap-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--muted)]/40">
                {h.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.imageUrl} alt={h.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageOff className="h-6 w-6 text-[var(--muted-foreground)] opacity-50" aria-hidden />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-meta">{h.collectionName || "Sans collection"}</p>
                <p className="text-2xl font-semibold tabular-nums" data-testid="nft-detail-retained">
                  {valuationDisplay.retainedDisplayText != null ? (
                    formatCurrency(valuationDisplay.retainedDisplayText, "EUR")
                  ) : (
                    <span className="text-lg italic text-[var(--warning)]">Valeur inconnue</span>
                  )}
                </p>
                <p className="text-meta">{valuationDisplay.methodLabel}</p>
                <NftBadgeList badges={badges} className="mt-1.5" />
              </div>
            </div>
          </section>

          {/* 2. Valorisation */}
          <FormSection title="Valorisation" step={2}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <ValueTile
                label="Valeur retenue"
                displayText={valuationDisplay.retainedDisplayText}
                hint="Utilisée par l'agrégation patrimoniale"
                strong
              />
              <ValueTile
                label="Floor de collection"
                displayText={h.collectionFloorPriceEur}
                hint="Indicateur de marché — non garanti"
              />
              <ValueTile
                label="Dernière vente"
                displayText={latestValuation?.lastSaleEur ?? null}
                hint="Prix observé lors d'une transaction connue"
              />
              <ValueTile
                label="Coût d'acquisition"
                displayText={acquisitionDisplay}
                hint="Prix payé (ou repli de valorisation)"
              />
              <ValueTile
                label="Expertise manuelle"
                displayText={latestValuation?.appraisedValueEur ?? null}
                hint="Prévaut sur toute autre méthode"
              />
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Confiance</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {latestValuation?.confidenceScore != null ? `${latestValuation.confidenceScore} %` : "—"}
                </p>
              </div>
            </div>
            <p className="text-meta mt-2">
              Méthode : <strong>{valuationDisplay.methodLabel}</strong>
              {h.retainedValueUpdatedAt
                ? ` · dernière valorisation : ${formatDateTimeParis(h.retainedValueUpdatedAt)}`
                : " · jamais valorisé"}
              {valuationDisplay.isStale ? " · périmée" : ""}
            </p>
            <p className="text-meta mt-1">{valuationDisplay.explanation}</p>
            {latestValuation?.fallbackReason && (
              <p className="text-meta mt-1 text-[var(--warning)]">{latestValuation.fallbackReason}</p>
            )}

            {overriding ? (
              <div className="mt-2 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2.5">
                <Field label="Expertise manuelle (€)" htmlFor="nft-appraisal-value">
                  <input
                    id="nft-appraisal-value"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={appraisalValue}
                    onChange={(e) => setAppraisalValue(e.target.value)}
                    data-testid="nft-detail-appraisal-value"
                  />
                </Field>
                <Field label="Raison" htmlFor="nft-appraisal-reason" optional>
                  <input
                    id="nft-appraisal-reason"
                    className="input mt-1 w-full"
                    placeholder="Pièce unique, collection illiquide…"
                    value={appraisalReason}
                    onChange={(e) => setAppraisalReason(e.target.value)}
                    data-testid="nft-detail-appraisal-reason"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!appraisalValue || overrideValuation.isPending}
                    onClick={() => overrideValuation.mutate()}
                    data-testid="nft-detail-appraisal-submit"
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

          {/* 3. Détention */}
          <FormSection title="Détention" step={3}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <Dt label="Propriétaire" value={h.ownerLabel ?? "—"} />
              <Dt label="Quote-part" value={h.ownershipShare ? `${h.ownershipShare} %` : "100 %"} />
              <Dt label="Wallet / plateforme" value={h.platformName} />
              <Dt label="Mode de garde" value={h.custodyModel} />
              <Dt label="Mode de collecte" value={h.dataOrigin === "MANUAL" ? "Saisie manuelle" : h.dataOrigin} />
              <Dt label="Date d'acquisition" value={h.acquisitionDate ? formatDate(h.acquisitionDate) : "—"} />
              {h.disposalDate && <Dt label="Date de sortie" value={formatDate(h.disposalDate)} />}
              <Dt label="Statut" value={nftHoldingStatusLabel(h.status)} />
              <Dt label="Quantité" value={h.quantity} />
              <Dt label="Masqué" value={h.isHidden ? "Oui" : "Non"} />
              <Dt label="Ignoré du patrimoine" value={h.isIgnoredInPortfolio ? "Oui" : "Non"} />
            </dl>
          </FormSection>

          {/* 4. Identité technique */}
          <FormSection title="Identité technique" step={4}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <Dt label="Chaîne" value={nftChainLabel(h.chainId)} />
              <Dt label="Standard" value={NFT_STANDARDS[h.standard as keyof typeof NFT_STANDARDS] ?? h.standard} />
              <Dt label="Contrat" value={h.contractAddress ?? "—"} />
              <Dt label="Token ID / mint" value={h.tokenId ?? h.mintAddress ?? "—"} />
              <Dt label="Ponté (bridge)" value={h.isBridged ? "Oui" : "Non"} />
              <Dt label="Wrappé" value={h.isWrapped ? "Oui" : "Non"} />
              <Dt label="Compressé" value={h.isCompressed ? "Oui" : "Non"} />
              <Dt label="Soulbound" value={h.isSoulbound ? "Oui" : "Non"} />
            </dl>
          </FormSection>

          {/* 5. Collection */}
          <FormSection title="Collection" step={5}>
            {h.collectionName ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                <Dt label="Nom" value={h.collectionName} />
                <Dt label="Slug" value={h.collectionSlug ?? "—"} />
                <Dt label="Créateur" value={h.collectionCreatorName ?? h.collectionCreatorAddress ?? "—"} />
                <Dt
                  label="Royalties"
                  value={h.collectionRoyaltiesBps != null ? `${(h.collectionRoyaltiesBps / 100).toFixed(2)} %` : "—"}
                />
                <Dt
                  label="Statut de vérification"
                  value={
                    h.collectionVerifiedStatus === "VERIFIED"
                      ? "Vérifiée"
                      : h.collectionVerifiedStatus === "UNVERIFIED"
                        ? "Non vérifiée"
                        : "Inconnu"
                  }
                />
                <Dt label="Floor collection" value={h.collectionFloorPriceEur ? formatCurrency(h.collectionFloorPriceEur, "EUR") : "—"} />
              </dl>
            ) : (
              <p className="text-meta">Ce NFT n&apos;est rattaché à aucune collection connue.</p>
            )}
          </FormSection>

          {/* 6. Traits / metadata */}
          <FormSection title="Traits / metadata" step={6}>
            <p className="text-meta">
              Qualité de la metadata : <strong>{metadataQualityLabel(h.metadataQuality)}</strong>
              {h.rarityRank != null ? ` · rang de rareté : ${h.rarityRank}` : ""}
            </p>
            {traits.length === 0 ? (
              <p className="text-meta mt-1">Aucun trait connu pour ce NFT.</p>
            ) : (
              <ul className="mt-1.5 grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
                {traits.map((t, i) => (
                  <li key={i} className="rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1">
                    <span className="text-meta block">{t.traitType}</span>
                    <span className="font-medium">{t.value}</span>
                    {t.rarityPct && <span className="text-meta ml-1">({t.rarityPct} %)</span>}
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          {/* 7. Historique / événements */}
          <FormSection title="Historique / événements" step={7}>
            <div id={`nft-detail-history-${assetId}`}>
              {events.length === 0 ? (
                <p className="text-meta">Aucun événement enregistré.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs" data-testid="nft-detail-events">
                  {events.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-2 border-b border-[var(--border)]/40 pb-1"
                    >
                      <span>
                        <span className="font-medium">
                          {NFT_EVENT_TYPES[e.eventType as keyof typeof NFT_EVENT_TYPES] ?? e.eventType}
                        </span>
                        {e.priceEur && <span className="text-meta ml-1.5">{formatCurrency(e.priceEur, "EUR")}</span>}
                        {e.marketplace && <span className="text-meta ml-1.5">{e.marketplace}</span>}
                      </span>
                      <span className="text-meta tabular-nums">{formatDateTimeParis(e.eventDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FormSection>

          {/* 8. Sync / providers */}
          <FormSection title="Sync / providers" step={8}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <Dt label="Origine" value={h.dataOrigin === "MANUAL" ? "Saisie manuelle" : h.dataOrigin} />
              <Dt
                label="Dernier événement source"
                value={events[0] ? `${events[0].sourceProvider} · ${formatDateTimeParis(events[0].eventDate)}` : "—"}
              />
              <Dt
                label="Dernière valorisation"
                value={
                  latestValuation
                    ? `${formatDateTimeParis(latestValuation.valuationDate)} (${nftValuationMethodLabel(latestValuation.valuationMethod)})`
                    : "—"
                }
              />
              <Dt label="Événements enregistrés" value={String(h.eventCount)} />
              <Dt label="Valorisation périmée" value={h.isStale ? "Oui" : "Non"} />
            </dl>
          </FormSection>

          {/* 9. Actions */}
          <FormSection title="Actions" step={9}>
            <div className="flex flex-wrap gap-2" data-testid="nft-detail-actions">
              {actions.map((a) => (
                <Button
                  key={a.id}
                  type="button"
                  variant={a.danger ? "danger" : "outline"}
                  size="sm"
                  onClick={() => runAction(a.id)}
                  data-testid={`nft-detail-action-${a.id}`}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </FormSection>
        </div>
      </Modal>

      {disposing && (
        <DisposeForm
          onCancel={() => setDisposing(false)}
          pending={dispose.isPending}
          onSubmit={(body) => dispose.mutate(body)}
        />
      )}

      {confirmAction === "dispose" && !disposing && (
        <ConfirmDialog
          open
          title="Dénouer ce NFT"
          message="Précisez comment ce NFT sort de votre patrimoine actif (vente, transfert, burn, pont…). L'historique reste consultable ensuite."
          confirmLabel="Continuer"
          danger={false}
          onConfirm={() => {
            setConfirmAction(null);
            setDisposing(true);
          }}
          onCancel={() => setConfirmAction(null)}
          testId="nft-confirm-dispose"
        />
      )}
    </>
  );
}

function DisposeForm({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [disposalSource, setDisposalSource] = useState("SOLD");
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [exitPriceEur, setExitPriceEur] = useState("");

  return (
    <Modal title="Dénouer ce NFT" onClose={onCancel} panelClassName="max-w-md" testId="nft-dispose-modal">
      <div className="space-y-3">
        <Field label="Motif de sortie" htmlFor="nft-dispose-source">
          <select
            id="nft-dispose-source"
            className="input mt-1 w-full"
            value={disposalSource}
            onChange={(e) => setDisposalSource(e.target.value)}
            data-testid="nft-dispose-source"
          >
            {Object.entries(NFT_DISPOSAL_SOURCES).map(([value, lbl]) => (
              <option key={value} value={value}>
                {lbl}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" htmlFor="nft-dispose-date">
          <input
            id="nft-dispose-date"
            type="date"
            className="input mt-1 w-full"
            value={disposalDate}
            onChange={(e) => setDisposalDate(e.target.value)}
            data-testid="nft-dispose-date"
          />
        </Field>
        {disposalSource === "SOLD" && (
          <Field label="Prix de vente (€)" htmlFor="nft-dispose-price" optional>
            <input
              id="nft-dispose-price"
              inputMode="decimal"
              className="input mt-1 w-full"
              value={exitPriceEur}
              onChange={(e) => setExitPriceEur(e.target.value)}
              data-testid="nft-dispose-price"
            />
          </Field>
        )}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              onSubmit({
                disposalSource,
                disposalDate,
                exitPriceEur: disposalSource === "SOLD" && exitPriceEur ? exitPriceEur : null,
              })
            }
            data-testid="nft-dispose-submit"
          >
            {pending ? "…" : "Confirmer la sortie"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ValueTile({
  label,
  displayText,
  hint,
  strong,
}: {
  label: string;
  displayText: string | null;
  hint: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn("rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2", strong && "bg-[var(--muted)]/40")}
      title={hint}
    >
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className={cn("mt-0.5 tabular-nums", strong ? "text-sm font-semibold" : "text-xs font-medium")}>
        {displayText != null ? (
          formatCurrency(displayText, "EUR")
        ) : (
          <span className="italic text-[var(--warning)]">Inconnue</span>
        )}
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

function metadataQualityLabel(q: string): string {
  switch (q) {
    case "COMPLETE":
      return "Complète";
    case "PARTIAL":
      return "Partielle";
    case "BROKEN":
      return "Cassée";
    default:
      return "Inconnue";
  }
}

"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { ClientDefiPortfolioBundle } from "@/app/lib/crypto/defi-ui-rules";
import { isProtocolUnknown } from "@/app/lib/crypto/defi-ui-rules";

type PlatformOption = {
  id: string;
  name: string;
  type: string | null;
  walletAddress: string | null;
};

type SyncResult = {
  positionsSeen: number;
  assetsTouched: number;
  txsCreated: number;
  errors: number;
};

/**
 * Flow de synchronisation — choisir la source, préciser owner/quote-part,
 * lancer, puis afficher un résultat qui distingue explicitement ce que la
 * synchronisation a produit (chiffres bruts de l'appel) de l'état du
 * portefeuille qu'elle laisse derrière elle (anomalies visibles après coup) :
 * confondre les deux ferait passer un diagnostic global pour un effet de
 * cette seule synchronisation.
 *
 * Seul `ZERION` est câblé (limite V1, cf. `docs/defi-backend-v1.md`) : les
 * options wallet/API/CSV existent dans la copie pour ne pas prétendre que
 * l'API et le CSV sont déjà supportés.
 */
export function DefiSyncModal({
  platforms,
  onClose,
  onSynced,
}: {
  platforms: PlatformOption[];
  onClose: () => void;
  onSynced: () => void;
}) {
  const [platformId, setPlatformId] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [ownershipPct, setOwnershipPct] = useState("100");
  const [result, setResult] = useState<SyncResult | null>(null);

  const wallets = platforms.filter((p) => p.type === "BLOCKCHAIN" && p.walletAddress);

  const sync = useMutation({
    mutationFn: () =>
      fetchJson<SyncResult>("/api/crypto/defi/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId,
          ownerLabel: ownerLabel || null,
          ownershipPct: ownershipPct || null,
        }),
      }),
    onSuccess: (data) => {
      setResult(data);
      onSynced();
      if (data.errors > 0) {
        toast.warning(`${data.errors} position(s) en erreur sur ${data.positionsSeen}`);
      } else {
        toast.success("Synchronisation terminée");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const portfolioQ = useQuery({
    queryKey: ["crypto-defi-portfolio-post-sync"],
    queryFn: () =>
      fetchJson<ClientDefiPortfolioBundle>("/api/crypto/defi/portfolio?platformId=" + platformId),
    enabled: result != null,
  });

  const anomalies = summarizeAnomalies(portfolioQ.data);

  return (
    <Modal title="Synchroniser un wallet" onClose={onClose} testId="defi-sync-modal">
      {!result ? (
        <div className="space-y-3" data-testid="defi-sync-form">
          <Field label="Wallet" htmlFor="defi-sync-wallet" hint="Seuls les wallets EVM sont synchronisables (Zerion).">
            <select
              id="defi-sync-wallet"
              className="input mt-1 w-full"
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
              data-testid="defi-sync-platform"
            >
              <option value="">— choisir —</option>
              {wallets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {wallets.length === 0 && (
              <p className="text-meta mt-1">
                Aucun wallet EVM enregistré — ajoutez d&apos;abord une plateforme de type
                blockchain avec une adresse.
              </p>
            )}
          </Field>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Détenteur" htmlFor="defi-sync-owner" optional>
              <input
                id="defi-sync-owner"
                className="input mt-1 w-full"
                value={ownerLabel}
                onChange={(e) => setOwnerLabel(e.target.value)}
                data-testid="defi-sync-owner"
              />
            </Field>
            <Field
              label="Quote-part détenue (%)"
              htmlFor="defi-sync-ownership"
              hint="Appliquée seulement aux nouvelles positions détectées."
            >
              <input
                id="defi-sync-ownership"
                inputMode="decimal"
                className="input mt-1 w-full"
                value={ownershipPct}
                onChange={(e) => setOwnershipPct(e.target.value)}
                data-testid="defi-sync-ownership"
              />
            </Field>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/10 p-2.5">
            <p className="text-meta">
              API de plateforme et import CSV arrivent dans une prochaine version — seule la
              synchronisation par wallet est disponible aujourd&apos;hui.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button
              type="button"
              disabled={!platformId || sync.isPending}
              onClick={() => sync.mutate()}
              data-testid="defi-sync-submit"
            >
              {sync.isPending ? "Synchronisation…" : "Lancer la synchronisation"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="defi-sync-result">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ResultTile label="Positions détectées" value={result.positionsSeen} />
            <ResultTile label="Positions touchées" value={result.assetsTouched} />
            <ResultTile label="Écritures créées" value={result.txsCreated} />
            <ResultTile
              label="Erreurs fournisseur"
              value={result.errors}
              tone={result.errors > 0 ? "warn" : undefined}
            />
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <p className="text-label">État du portefeuille DeFi après synchronisation</p>
            {portfolioQ.isPending ? (
              <p className="text-meta mt-1">Chargement…</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-xs">
                <li>Protocoles non reconnus : <strong>{anomalies.unknownProtocol}</strong></li>
                <li>Valorisations manquantes : <strong>{anomalies.unvaluable}</strong></li>
                <li>Doublons potentiels signalés : <strong>{anomalies.duplicates}</strong></li>
                <li>Positions à risque : <strong>{anomalies.risk}</strong></li>
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
            <Button type="button" variant="outline" onClick={onClose} data-testid="defi-sync-close">
              Fermer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResultTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p
        className={
          "mt-0.5 text-sm font-semibold tabular-nums" +
          (tone === "warn" && value > 0 ? " text-[var(--warning)]" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function summarizeAnomalies(bundle: ClientDefiPortfolioBundle | undefined) {
  if (!bundle) return { unknownProtocol: 0, unvaluable: 0, duplicates: 0, risk: 0 };
  return {
    unknownProtocol: bundle.positions.filter((p) => isProtocolUnknown(p.protocol, p.underlyingProtocol))
      .length,
    unvaluable: bundle.valuationQuality.unvaluableCount,
    duplicates: bundle.excluded.duplicateCount,
    risk: bundle.debtAlerts.length,
  };
}

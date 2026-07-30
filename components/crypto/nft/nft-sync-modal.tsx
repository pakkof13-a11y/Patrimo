"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NFT_CHAIN_OPTIONS, type ClientNftPortfolioBundle } from "@/app/lib/crypto/nft-ui-rules";

type PlatformOption = {
  id: string;
  name: string;
  type: string | null;
  walletAddress: string | null;
};

type SyncResult = {
  ok: boolean;
  reason: string | null;
  itemsFound: number;
  assetsCreated: number;
  assetsExisting: number;
  reappeared: number;
  missingFlagged: number;
  completed: boolean;
};

const REASON_LABELS: Record<string, string> = {
  "not-configured": "clé API non configurée",
  "not-found": "collection ou wallet introuvable sur ce provider",
  "rate-limited": "quota de requêtes atteint",
  "network-error": "erreur réseau",
};

/**
 * Flow de synchronisation wallet — choisir le wallet puis la chaîne à
 * interroger, lancer, puis afficher un résultat qui distingue ce que
 * *cette* synchronisation a produit (chiffres bruts de l'appel) de l'état
 * du wallet qu'elle laisse derrière elle (anomalies visibles après coup) —
 * même principe que `DefiSyncModal`.
 *
 * Pas d'étape « propriétaire / quote-part » : la route
 * `POST /api/crypto/nft/sync` ne les accepte pas aujourd'hui (limite V1,
 * `docs/nft-backend-v1.md`) — un NFT découvert peut être précisé ensuite
 * depuis son détail (action « Éditer »), jamais silencieusement ignoré ici.
 */
export function NftSyncModal({
  platforms,
  onClose,
  onSynced,
}: {
  platforms: PlatformOption[];
  onClose: () => void;
  onSynced: () => void;
}) {
  const [platformId, setPlatformId] = useState("");
  const [chain, setChain] = useState("ethereum");
  const [result, setResult] = useState<SyncResult | null>(null);

  const wallets = platforms.filter((p) => p.type === "BLOCKCHAIN" && p.walletAddress);

  const sync = useMutation({
    mutationFn: () =>
      fetchJson<SyncResult>("/api/crypto/nft/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId, chain }),
      }),
    onSuccess: (data) => {
      setResult(data);
      if (!data.ok) {
        toast.info(
          `Synchronisation impossible — ${REASON_LABELS[data.reason ?? ""] ?? data.reason ?? "raison inconnue"}.`
        );
        return;
      }
      onSynced();
      if (data.assetsCreated > 0) {
        toast.success(`${data.assetsCreated} NFT découvert(s)`);
      } else {
        toast.success(`Aucun nouveau NFT — ${data.assetsExisting} déjà connu(s)`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const portfolioQ = useQuery({
    queryKey: ["crypto-nft-portfolio-post-sync", platformId],
    queryFn: () =>
      fetchJson<ClientNftPortfolioBundle>(
        `/api/crypto/nft/portfolio?platformId=${encodeURIComponent(platformId)}&includeInactive=true`
      ),
    enabled: result != null && result.ok,
  });

  const anomalies = summarizeAnomalies(portfolioQ.data);

  return (
    <Modal title="Synchroniser un wallet" onClose={onClose} testId="nft-sync-modal">
      {!result ? (
        <div className="space-y-3" data-testid="nft-sync-form">
          <Field
            label="Wallet"
            htmlFor="nft-sync-wallet"
            hint="Seuls les wallets EVM (OpenSea) et Solana (Magic Eden) sont synchronisables."
          >
            <select
              id="nft-sync-wallet"
              className="input mt-1 w-full"
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
              data-testid="nft-sync-platform"
            >
              <option value="">— choisir —</option>
              {wallets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {wallets.length === 0 && (
              <p className="text-meta mt-1" data-testid="nft-sync-no-wallet-hint">
                Aucun wallet enregistré avec une adresse — ajoutez-en un depuis « Mes plateformes ».
              </p>
            )}
          </Field>

          <Field label="Chaîne à interroger" htmlFor="nft-sync-chain">
            <select
              id="nft-sync-chain"
              className="input mt-1 w-full"
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              data-testid="nft-sync-chain"
            >
              {NFT_CHAIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/10 p-2.5">
            <p className="text-meta">
              Le propriétaire et la quote-part des NFT découverts ne sont pas encore réglables ici —
              complétez-les depuis le détail de chaque NFT après la synchronisation, si nécessaire.
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
              data-testid="nft-sync-submit"
            >
              {sync.isPending ? "Recherche…" : "Lancer la synchronisation"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="nft-sync-result">
          {!result.ok ? (
            <p className="text-sm text-[var(--warning)]" data-testid="nft-sync-not-configured">
              Synchronisation impossible — {REASON_LABELS[result.reason ?? ""] ?? result.reason}.
              Configurez la clé API du provider correspondant pour l&apos;activer.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <ResultTile label="NFT détectés" value={result.itemsFound} />
                <ResultTile label="Nouveaux NFT" value={result.assetsCreated} />
                <ResultTile label="Déjà connus" value={result.assetsExisting} />
                <ResultTile label="Réapparus" value={result.reappeared} />
                <ResultTile
                  label="Disparus (historisés)"
                  value={result.missingFlagged}
                  tone={result.missingFlagged > 0 ? "warn" : undefined}
                />
              </div>
              {!result.completed && (
                <p className="text-meta text-[var(--warning)]">
                  Wallet volumineux — seule une partie a été lue. Relancez la synchronisation pour
                  continuer là où elle s&apos;est arrêtée.
                </p>
              )}

              <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <p className="text-label">État du wallet après synchronisation</p>
                {portfolioQ.isPending ? (
                  <p className="text-meta mt-1">Chargement…</p>
                ) : (
                  <ul className="mt-1.5 space-y-1 text-xs" data-testid="nft-sync-review">
                    <li>
                      Spam / suspects : <strong>{anomalies.spamOrSuspect}</strong>
                    </li>
                    <li>
                      Sans metadata exploitable : <strong>{anomalies.noMetadata}</strong>
                    </li>
                    <li>
                      Sans floor connu : <strong>{anomalies.noFloor}</strong>
                    </li>
                    <li>
                      Sans estimation fiable : <strong>{anomalies.unvaluable}</strong>
                    </li>
                    <li>
                      Doublons potentiels signalés : <strong>{anomalies.duplicates}</strong>
                    </li>
                  </ul>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
            {result.ok && !result.completed && (
              <Button
                type="button"
                variant="outline"
                disabled={sync.isPending}
                onClick={() => sync.mutate()}
                data-testid="nft-sync-continue"
              >
                {sync.isPending ? "Reprise…" : "Continuer la synchronisation"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} data-testid="nft-sync-close">
              Fermer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResultTile({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p
        className={
          "mt-0.5 text-sm font-semibold tabular-nums" + (tone === "warn" && value > 0 ? " text-[var(--warning)]" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function summarizeAnomalies(bundle: ClientNftPortfolioBundle | undefined) {
  if (!bundle) {
    return { spamOrSuspect: 0, noMetadata: 0, noFloor: 0, unvaluable: 0, duplicates: 0 };
  }
  return {
    spamOrSuspect: bundle.holdings.filter((h) => h.isSpam || h.isScamSuspected).length,
    noMetadata: bundle.holdings.filter((h) => h.metadataQuality === "UNKNOWN" || h.metadataQuality === "BROKEN").length,
    noFloor: bundle.holdings.filter((h) => !h.collectionFloorPriceEur).length,
    unvaluable: bundle.valuationQuality.unvaluableCount,
    duplicates: bundle.excluded.duplicateCount,
  };
}

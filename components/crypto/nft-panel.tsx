"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Grid3x3, List } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  NFT_STANDARDS,
  nftChainLabel,
  nftEstimateSourceLabel,
} from "@/app/lib/crypto/nft-constants";

type NftRow = {
  assetId: string;
  name: string;
  tokenId: string;
  chain: string;
  collectionName: string | null;
  collectionSlug: string | null;
  imageUrl: string | null;
  standard: string | null;
  valuationMode: string;
  floorPriceEur: string | null;
  estimateSource: string | null;
  estimateDate: string | null;
  rarityRank: number | null;
  isHidden: boolean;
  acquisitionPriceEur: string;
  currentValueEur: string;
};

type PlatformRow = { id: string; name: string; type?: string | null };

type RefreshResult = {
  collectionsProcessed: number;
  itemsUpdated: number;
  results: Array<{
    collectionKey: string;
    ok: boolean;
    source: string;
    reason: string | null;
  }>;
};

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const REASON_LABELS: Record<string, string> = {
  "not-configured": "clé API non configurée",
  "not-found": "collection introuvable",
  "rate-limited": "quota atteint",
  "network-error": "erreur réseau",
};

const emptyForm = {
  platformId: "",
  name: "",
  tokenId: "",
  chain: "ethereum",
  collectionName: "",
  collectionSlug: "",
  contractAddr: "",
  imageUrl: "",
  standard: "ERC_721",
  quantity: "1",
  acquisitionPriceEur: "",
  acquisitionDate: new Date().toISOString().slice(0, 10),
  manualFloorPriceEur: "",
};

/**
 * Galerie NFT.
 *
 * Fonctionne intégralement sans aucune clé API : la saisie manuelle, la
 * valeur au journal, le masquage du spam et la valorisation manuelle ne
 * dépendent d'aucun provider externe. Seul le bouton « Rafraîchir les floor
 * prices » a besoin d'une clé (OpenSea, Magic Eden…) — tant qu'elle est
 * absente, il rapporte proprement pourquoi plutôt que d'échouer.
 */
export function NftPanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"gallery" | "table">("gallery");
  const [showHidden, setShowHidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const q = useQuery({
    queryKey: ["crypto-nft", showHidden],
    queryFn: () =>
      fetchJson<{ items: NftRow[] }>(
        `/api/crypto/nft${showHidden ? "?hidden=1" : ""}`
      ),
  });

  const platformsQ = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fetchJson<{ platforms: PlatformRow[] }>("/api/platforms"),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crypto-nft"] });
    void qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crypto/nft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          contractAddr: form.contractAddr || null,
          collectionName: form.collectionName || null,
          collectionSlug: form.collectionSlug || null,
          imageUrl: form.imageUrl || null,
          manualFloorPriceEur: form.manualFloorPriceEur || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Création impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("NFT ajouté");
      setForm(emptyForm);
      setShowForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleHidden = useMutation({
    mutationFn: async ({ assetId, hidden }: { assetId: string; hidden: boolean }) => {
      const res = await fetch(`/api/crypto/nft/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden: hidden }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Mise à jour impossible");
      }
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (assetId: string) => {
      const res = await fetch(`/api/crypto/nft?assetId=${encodeURIComponent(assetId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Suppression impossible");
      }
    },
    onSuccess: () => {
      toast.success("NFT retiré");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refresh = useMutation({
    mutationFn: () => fetchJson<RefreshResult>("/api/crypto/nft/estimate", { method: "POST" }),
    onSuccess: (r) => {
      if (r.itemsUpdated > 0) {
        toast.success(
          `${r.itemsUpdated} NFT réévalué(s) sur ${r.collectionsProcessed} collection(s)`
        );
      } else {
        const reasons = new Set(r.results.map((x) => x.reason).filter(Boolean));
        const reasonText = [...reasons]
          .map((r) => REASON_LABELS[r as string] ?? r)
          .join(", ");
        toast.info(
          `Aucune estimation appliquée — ${reasonText || "aucun provider disponible"}. Configurez les clés API pour l'activer.`
        );
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canSubmit =
    form.platformId &&
    form.name.trim() &&
    form.tokenId.trim() &&
    form.chain.trim() &&
    form.acquisitionPriceEur;

  const items = q.data?.items ?? [];
  const totals = items.reduce(
    (acc, it) => ({
      floor: acc.floor + num(it.currentValueEur),
      acquisition: acc.acquisition + num(it.acquisitionPriceEur),
    }),
    { floor: 0, acquisition: 0 }
  );
  const collectionCount = new Set(
    items.map((it) => it.collectionSlug || it.collectionName || it.assetId)
  ).size;

  if (q.isPending) {
    return <Skeleton className={cn("h-64 w-full", className)} />;
  }

  return (
    <section className={cn("card p-4", className)} data-testid="crypto-nft-panel">
      <PanelHeader
        title="Galerie NFT"
        subtitle="Valeur au journal, floor price estimé par collection"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending || items.length === 0}
              data-testid="nft-refresh-floor"
            >
              {refresh.isPending ? "Estimation…" : "Rafraîchir les floor prices"}
            </Button>
            <Button
              type="button"
              variant={showForm ? "outline" : "default"}
              onClick={() => setShowForm((v) => !v)}
              data-testid="nft-form-toggle"
            >
              {showForm ? "Annuler" : "Ajouter un NFT"}
            </Button>
          </div>
        }
      />

      {showForm && (
        <div
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3"
          data-testid="nft-form"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-meta block">
              Plateforme
              <select
                className="input mt-1 w-full"
                value={form.platformId}
                onChange={(e) => set("platformId", e.target.value)}
                data-testid="nft-platform"
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
              Nom
              <input
                className="input mt-1 w-full"
                placeholder="Bored Ape #1234"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                data-testid="nft-name"
              />
            </label>

            <label className="text-meta block">
              Token ID
              <input
                className="input mt-1 w-full"
                value={form.tokenId}
                onChange={(e) => set("tokenId", e.target.value)}
                data-testid="nft-token-id"
              />
            </label>

            <label className="text-meta block">
              Chaîne
              <select
                className="input mt-1 w-full"
                value={form.chain}
                onChange={(e) => set("chain", e.target.value)}
                data-testid="nft-chain"
              >
                <option value="ethereum">Ethereum</option>
                <option value="base">Base</option>
                <option value="polygon">Polygon</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="optimism">Optimism</option>
                <option value="solana">Solana</option>
              </select>
            </label>

            <label className="text-meta block">
              Standard
              <select
                className="input mt-1 w-full"
                value={form.standard}
                onChange={(e) => set("standard", e.target.value)}
              >
                {Object.entries(NFT_STANDARDS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Collection
              <input
                className="input mt-1 w-full"
                placeholder="Bored Ape Yacht Club"
                value={form.collectionName}
                onChange={(e) => set("collectionName", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Slug de collection
              <input
                className="input mt-1 w-full"
                placeholder="boredapeyachtclub"
                value={form.collectionSlug}
                onChange={(e) => set("collectionSlug", e.target.value)}
                data-testid="nft-collection-slug"
              />
            </label>

            <label className="text-meta block">
              Adresse du contrat
              <input
                className="input mt-1 w-full"
                value={form.contractAddr}
                onChange={(e) => set("contractAddr", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Image (URL)
              <input
                className="input mt-1 w-full"
                value={form.imageUrl}
                onChange={(e) => set("imageUrl", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Prix d&apos;acquisition (€)
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                value={form.acquisitionPriceEur}
                onChange={(e) => set("acquisitionPriceEur", e.target.value)}
                data-testid="nft-acquisition-price"
              />
            </label>

            <label className="text-meta block">
              Date d&apos;acquisition
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.acquisitionDate}
                onChange={(e) => set("acquisitionDate", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Floor price manuel (€)
              <input
                inputMode="decimal"
                className="input mt-1 w-full"
                placeholder="Optionnel"
                value={form.manualFloorPriceEur}
                onChange={(e) => set("manualFloorPriceEur", e.target.value)}
                data-testid="nft-manual-floor"
              />
            </label>
          </div>

          <p className="text-meta mt-2">
            Sans floor price manuel, la valeur retenue est le prix
            d&apos;acquisition — à corriger une fois une estimation
            disponible.
          </p>

          <div className="mt-3">
            <Button
              type="button"
              disabled={!canSubmit || create.isPending}
              onClick={() => create.mutate()}
              data-testid="nft-submit"
            >
              {create.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && !showHidden ? (
        <EmptyPlaceholder
          compact
          title="Aucun NFT"
          description="Ajoutez un NFT à la main, ou connectez un wallet EVM/Solana pour la synchronisation."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Valeur estimée", value: totals.floor, strong: true },
              { label: "Coût d'acquisition", value: totals.acquisition },
              {
                label: "PV / MV latente",
                value: totals.floor - totals.acquisition,
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
                Collections · NFT
              </p>
              <p className="mt-0.5 text-xs font-medium tabular-nums">
                {collectionCount} · {items.length}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={cn(
                  "btn btn-ghost h-8 w-8 p-0",
                  view === "gallery" && "bg-[var(--primary-soft)]"
                )}
                onClick={() => setView("gallery")}
                aria-label="Vue galerie"
                data-testid="nft-view-gallery"
              >
                <Grid3x3 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(
                  "btn btn-ghost h-8 w-8 p-0",
                  view === "table" && "bg-[var(--primary-soft)]"
                )}
                onClick={() => setView("table")}
                aria-label="Vue tableau"
                data-testid="nft-view-table"
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                data-testid="nft-show-hidden"
              />
              Afficher les NFT masqués
            </label>
          </div>

          {view === "gallery" ? (
            <div
              className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4"
              data-testid="nft-gallery"
            >
              {items.map((it) => (
                <div
                  key={it.assetId}
                  className={cn(
                    "overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]",
                    it.isHidden && "opacity-50"
                  )}
                  data-testid="nft-card"
                >
                  <div className="aspect-square w-full bg-[var(--muted)]/40">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.imageUrl}
                        alt={it.name}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium" title={it.name}>
                      {it.name}
                    </p>
                    <p className="text-meta truncate">
                      {it.collectionName || nftChainLabel(it.chain)}
                    </p>
                    <p className="mt-1 text-xs font-semibold tabular-nums">
                      {formatCurrency(it.currentValueEur, "EUR")}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost text-[10px]"
                        onClick={() =>
                          toggleHidden.mutate({ assetId: it.assetId, hidden: !it.isHidden })
                        }
                        data-testid="nft-toggle-hidden"
                      >
                        {it.isHidden ? "Réafficher" : "Masquer"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-[10px] text-[var(--danger)]"
                        onClick={() => remove.mutate(it.assetId)}
                      >
                        Suppr.
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs" data-testid="nft-table">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="py-1.5 pr-2">Nom</th>
                    <th className="py-1.5 pr-2">Collection</th>
                    <th className="py-1.5 pr-2">Chaîne</th>
                    <th className="py-1.5 pr-2 text-right">Acquisition</th>
                    <th className="py-1.5 pr-2 text-right">Valeur</th>
                    <th className="py-1.5">Source</th>
                    <th className="py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr
                      key={it.assetId}
                      className={cn("border-b border-[var(--border)]/50", it.isHidden && "opacity-50")}
                      data-testid="nft-row"
                    >
                      <td className="py-1.5 pr-2 font-medium">{it.name}</td>
                      <td className="py-1.5 pr-2">{it.collectionName || "—"}</td>
                      <td className="py-1.5 pr-2">{nftChainLabel(it.chain)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatCurrency(it.acquisitionPriceEur, "EUR")}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                        {formatCurrency(it.currentValueEur, "EUR")}
                      </td>
                      <td className="py-1.5">
                        {it.estimateSource ? nftEstimateSourceLabel(it.estimateSource) : "—"}
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px]"
                            onClick={() =>
                              toggleHidden.mutate({ assetId: it.assetId, hidden: !it.isHidden })
                            }
                          >
                            {it.isHidden ? "Réafficher" : "Masquer"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px] text-[var(--danger)]"
                            onClick={() => remove.mutate(it.assetId)}
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
        </>
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  GitMerge,
  LayoutList,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { TableFilters, matchesSearchQuery } from "@/components/ui/table-filters";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { PLATFORM_TYPES } from "@/app/lib/constants";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { formatCurrency, cn } from "@/app/lib/utils";
import { fetchJson } from "@/app/lib/api-client";
import type { PlatformRow } from "@/app/lib/types/ui";
import type { SolanaPortfolioSnapshot } from "@/app/lib/solana";
import {
  availableApiStatusMessage,

  describeChainSyncFeatures,
  ZERION_HELP_MESSAGE,
  missingApiStatusMessage,
  resolveChainSyncForPlatform,
} from "@/app/lib/market/chain-wallet-sync";
import { toast } from "sonner";

/** Base58 Solana (aligné côté serveur) — pas d’appel API si EVM. */
function looksLikeSolanaAddress(addr: string | null | undefined): boolean {
  const a = (addr || "").trim();
  if (!a || a.startsWith("0x") || a.startsWith("0X")) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

function formatTokenQty(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  }
  if (Math.abs(n) >= 1) {
    return n.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
  }
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 6 });
}

function typeLabel(type: string) {
  return PLATFORM_TYPES[type as keyof typeof PLATFORM_TYPES] || type;
}

function formatLastTx(iso: string | null | undefined): string {
  if (!iso) return "Aucune transaction";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Types éditables = enum backend `platformTypes` (aligné Zod / API). */
const TYPE_OPTIONS = Object.entries(PLATFORM_TYPES).sort(([, a], [, b]) =>
  a.localeCompare(b, "fr")
);

export function PlatformsTab({
  platforms,
  baseCurrency,
  onDelete,
  deletePendingId,
  onMerged,
  onUpdated,
  onAddPlatform,
  onNewTransaction,
  onViewPositions,
}: {
  platforms: PlatformRow[];
  baseCurrency: string;
  onDelete?: (platform: PlatformRow, opts?: { force?: boolean }) => void;
  deletePendingId?: string | null;
  onMerged?: () => void | Promise<void>;
  onUpdated?: () => void;
  /** Création directe de plateforme (modale catalogue / type). */
  onAddPlatform?: () => void;
  /** Nouvelle transaction pré-remplie avec la plateforme. */
  onNewTransaction?: (platform: PlatformRow) => void;
  /** Ouvre Positions avec filtre plateforme. */
  onViewPositions?: (platform: PlatformRow) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const debouncedSearch = useDebouncedValue(search, 300);

  const [editTarget, setEditTarget] = useState<PlatformRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("AUTRE");
  const [editLogo, setEditLogo] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editWallet, setEditWallet] = useState("");
  /** Vide = serveur utilise ZERION_API_KEY */
  const [editApiKey, setEditApiKey] = useState("");
  const [editMoneroAmount, setEditMoneroAmount] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editSyncing, setEditSyncing] = useState(false);

  const [mergeSource, setMergeSource] = useState<PlatformRow | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergePending, setMergePending] = useState(false);

  /** Suppression plateforme (cascade txs/actifs) */
  const [deleteTarget, setDeleteTarget] = useState<PlatformRow | null>(null);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const DELETE_CONFIRM_WORD = "SUPPRIMER";
  const canForceDelete =
    deleteConfirmChecked &&
    deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD;

  /** Snapshots Solana lecture seule (hors ledger) — clé = platformId */
  const [solanaSnaps, setSolanaSnaps] = useState<
    Record<string, SolanaPortfolioSnapshot>
  >({});
  const [solanaLoadingId, setSolanaLoadingId] = useState<string | null>(null);
  /** Sync Zerion plafonnée (800 txs) — bannière par plateforme */
  const [historyTruncatedByPlatform, setHistoryTruncatedByPlatform] = useState<
    Record<string, boolean>
  >({});
  const [solanaDetail, setSolanaDetail] = useState<{
    platform: PlatformRow;
    snapshot: SolanaPortfolioSnapshot;
  } | null>(null);
  const [onchainTxs, setOnchainTxs] = useState<
    Array<{
      signature: string;
      blockTime: string | null;
      status: string;
      type: string | null;
      transfers: Array<{
        kind: string;
        direction: string;
        amount: string;
        mint?: string | null;
        symbol?: string;
      }>;
    }>
  >([]);
  const [onchainTxsLoading, setOnchainTxsLoading] = useState(false);

  /** Aperçu rapide (double-clic / menu / Entrée) */
  const [previewTarget, setPreviewTarget] = useState<PlatformRow | null>(null);

  useEffect(() => {
    if (!solanaDetail?.platform.id) {
      setOnchainTxs([]);
      return;
    }
    let cancelled = false;
    setOnchainTxsLoading(true);
    void fetchJson<{
      transactions: typeof onchainTxs;
    }>(
      `/api/wallets/solana/transactions?platformId=${encodeURIComponent(solanaDetail.platform.id)}&limit=40`
    )
      .then((res) => {
        if (!cancelled) setOnchainTxs(res.transactions ?? []);
      })
      .catch(() => {
        if (!cancelled) setOnchainTxs([]);
      })
      .finally(() => {
        if (!cancelled) setOnchainTxsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [solanaDetail?.platform.id, solanaDetail?.snapshot.fetchedAt]);

  function openPreview(p: PlatformRow) {
    setMenuOpenId(null);
    setPreviewTarget(p);
  }

  useEffect(() => {
    if (!menuOpenId) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpenId]);

  const typesPresent = useMemo(() => {
    const set = new Set(platforms.map((p) => p.type));
    return [...set].sort((a, b) => {
      const la = typeLabel(a);
      const lb = typeLabel(b);
      return la.localeCompare(lb, "fr");
    });
  }, [platforms]);

  const sorted = useMemo(() => {
    const list =
      typeFilter === "ALL"
        ? [...platforms]
        : platforms.filter((p) => p.type === typeFilter);
    const searched = list.filter((p) =>
      matchesSearchQuery(debouncedSearch, [
        p.name,
        p.type,
        typeLabel(p.type),
        p.walletAddress,
        p.subtype,
        p.notes,
      ])
    );
    return searched.sort((a, b) => {
      const va = Number(b.totalValueBase || b.totalValueEur || b.cashBase || 0);
      const vb = Number(a.totalValueBase || a.totalValueEur || a.cashBase || 0);
      if (va !== vb) return va - vb;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
  }, [platforms, typeFilter, debouncedSearch]);

  function openEdit(p: PlatformRow) {
    setMenuOpenId(null);
    setEditTarget(p);
    setEditName(p.name);
    // Normalise type inconnu / legacy → AUTRE pour coller à l’enum select
    const rawType = (p.type || "AUTRE").trim();
    const allowed = new Set(Object.keys(PLATFORM_TYPES));
    setEditType(allowed.has(rawType) ? rawType : "AUTRE");
    setEditLogo(p.logoUrl || "");
    setEditNotes(p.notes || "");
    setEditWallet(p.walletAddress || "");
    const cap = resolveChainSyncForPlatform({
      name: p.name,
      type: p.type,
      logoKey: p.logoKey,
    });
    setEditApiKey(
      (p as { walletApiKey?: string | null }).walletApiKey ||
        cap?.defaultApiKey ||
        ""
    );
    setEditMoneroAmount("");
  }

  function openMerge(p: PlatformRow) {
    setMenuOpenId(null);
    setMergeSource(p);
    const other = platforms.find((x) => x.id !== p.id);
    setMergeTargetId(other?.id || "");
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    if (editName.trim().length < 2) {
      toast.error("Nom trop court");
      return;
    }
    if (editLogo.trim() && !/^https?:\/\//i.test(editLogo.trim())) {
      toast.error("URL logo invalide");
      return;
    }
    const allowed = new Set(Object.keys(PLATFORM_TYPES));
    if (!allowed.has(editType)) {
      toast.error("Type de plateforme invalide");
      return;
    }
    setEditSaving(true);
    try {
      const logo = editLogo.trim();
      const wallet = editWallet.trim();
      const apiKey = editApiKey.trim();
      await fetchJson("/api/platforms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTarget.id,
          name: editName.trim(),
          type: editType,
          // null = effacer ; string http(s) = URL ; omis si inchangé non requis
          logoUrl: logo.length > 0 ? logo : null,
          notes: editNotes.trim().length > 0 ? editNotes.trim() : null,
          walletAddress: wallet.length > 0 ? wallet : null,
          walletApiKey: apiKey.length > 0 ? apiKey : null,
        }),
      });
      toast.success("Plateforme mise à jour");
      setEditTarget(null);
      onUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la mise à jour");
    } finally {
      setEditSaving(false);
    }
  }

  async function syncFromEdit() {
    if (!editTarget) return;
    const wallet = editWallet.trim();
    const cap = resolveChainSyncForPlatform({
      name: editName || editTarget.name,
      type: editType,
      logoKey: editTarget.logoKey,
    });
    if (!cap?.syncPath) {
      toast.error(missingApiStatusMessage());
      return;
    }

    // Monero : solde manuel
    if (cap.provider === "monero-manual") {
      const amt = Number(String(editMoneroAmount).replace(",", "."));
      if (!Number.isFinite(amt) || amt < 0) {
        toast.error("Indiquez un solde XMR valide");
        return;
      }
      setEditSyncing(true);
      try {
        const res = await fetchJson<{
          ok: boolean;
          ledgerWritten?: boolean;
          ledger?: { assetsTouched: number; txsCreated: number } | null;
          snapshot?: { amount: number; ticker: string; usdValue: number | null };
        }>(cap.syncPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platformId: editTarget.id,
            amount: amt,
            writeLedger: true,
          }),
        });
        toast.success(
          res.ledgerWritten && res.ledger
            ? `Monero · ${res.ledger.assetsTouched} position(s) · ${amt} XMR`
            : `Monero synchronisé · ${amt} XMR`
        );
        onUpdated?.();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Échec sync Monero"
        );
      } finally {
        setEditSyncing(false);
      }
      return;
    }

    if (!wallet) {
      toast.error("Renseignez une adresse wallet avant de synchroniser");
      return;
    }
    if (!cap.validateAddress(wallet)) {
      toast.error(`Adresse invalide pour ${cap.label}`);
      return;
    }
    setEditSyncing(true);
    try {
      const apiKey = editApiKey.trim();
      await fetchJson("/api/platforms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTarget.id,
          walletAddress: wallet,
          walletApiKey:
            cap.provider === "zerion"
              ? apiKey || null
              : undefined,
          type: editType === "BLOCKCHAIN" ? editType : "BLOCKCHAIN",
        }),
      });

      if (cap.provider === "zerion") {
        const res = await fetchJson<{
          ok: boolean;
          ledgerWritten?: boolean;
          ledgerError?: string | null;
          ledger?: {
            assetsTouched: number;
            txsCreated: number;
            historyTxsCreated?: number;
            errors?: number;
          } | null;
          history?: { historyTxsCreated?: number } | null;
          summary?: {
            balances?: number;
            transactions?: number;
            assetsTouched?: number;
            ledgerTxs?: number;
            historyTxs?: number;
          };
          portfolio?: {
            balances: unknown[];
            transactions: unknown[];
          };
        }>(cap.syncPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platformId: editTarget.id,
            address: wallet,
            // Vide → backend ZERION_API_KEY
            apiKey: apiKey || undefined,
            chainPreset: editTarget.logoKey || cap.presetKey,
            // Filtre par chaîne de la plateforme (évite de fusionner toutes les EVM)
            allChains: false,
            writeLedger: true,
          }),
        });
        const nBal =
          res.summary?.balances ?? res.portfolio?.balances?.length ?? 0;
        const nTx =
          res.summary?.transactions ??
          res.portfolio?.transactions?.length ??
          0;
        const nAssets =
          res.summary?.assetsTouched ?? res.ledger?.assetsTouched ?? 0;
        const nHist =
          res.summary?.historyTxs ??
          res.history?.historyTxsCreated ??
          res.ledger?.historyTxsCreated ??
          0;
        if (res.ledgerError) {
          toast.message(
            `Zerion · ${nBal} solde(s) API · ledger : ${res.ledgerError}`
          );
        } else if (nBal === 0 && nTx === 0) {
          toast.message(
            "Zerion · aucun solde / tx pour cette adresse (vérifiez l’adresse ou la clé API)"
          );
        } else {
          toast.success(
            `Zerion · ${nAssets} position(s) · ${nBal} solde(s) · ${nHist} tx journal · ${nTx} tx API`
          );
        }
        onUpdated?.();
        return;
      }

      // Solana (Helius / module existant — inchangé)
      const res = await fetchJson<{
        ok: boolean;
        snapshot: SolanaPortfolioSnapshot;
        ledgerWritten?: boolean;
        ledgerError?: string | null;
        ledger?: { assetsTouched: number; txsCreated: number } | null;
        txSync?: {
          newTransactions: number;
          fetchedSignatures: number;
          truncated?: boolean;
          notice?: string | null;
        } | null;
      }>(cap.syncPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId: editTarget.id,
          address: wallet,
          writeLedger: true,
          syncTransactions: true,
        }),
      });
      setSolanaSnaps((prev) => ({ ...prev, [editTarget.id]: res.snapshot }));
      const txN = res.txSync?.newTransactions ?? 0;
      const txPart =
        txN > 0
          ? ` · ${txN} tx on-chain`
          : res.txSync?.fetchedSignatures
            ? ` · ${res.txSync.fetchedSignatures} sig. lues`
            : "";
      if (res.ledgerWritten && res.ledger) {
        toast.success(
          `Synchronisation OK · ${res.ledger.assetsTouched} position(s)${txPart}`
        );
      } else if (res.ledgerError) {
        toast.message(`Snapshot OK — positions : ${res.ledgerError}${txPart}`);
      } else {
        toast.success(`Synchronisation on-chain réussie${txPart}`);
      }
      onUpdated?.();
      setSolanaDetail({
        platform: { ...editTarget, walletAddress: wallet },
        snapshot: res.snapshot,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Échec de la synchronisation"
      );
    } finally {
      setEditSyncing(false);
    }
  }

  async function runMerge() {
    if (!mergeSource || !mergeTargetId) return;
    const target = platforms.find((p) => p.id === mergeTargetId);
    if (!target) return;
    const ok = window.confirm(
      `Fusionner « ${mergeSource.name} » dans « ${target.name} » ?\n\n` +
        `Tous les actifs et transactions de « ${mergeSource.name} » seront rattachés à « ${target.name} », ` +
        `puis « ${mergeSource.name} » sera supprimé. Irréversible.`
    );
    if (!ok) return;
    setMergePending(true);
    try {
      await fetchJson("/api/platforms/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: mergeSource.id,
          targetId: mergeTargetId,
        }),
      });
      toast.success(`Fusionné dans « ${target.name} »`);
      setMergeSource(null);
      await onMerged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la fusion");
    } finally {
      setMergePending(false);
    }
  }

  function handleDelete(p: PlatformRow) {
    if (!onDelete) return;
    setMenuOpenId(null);
    setDeleteTarget(p);
    setDeleteConfirmChecked(false);
    setDeleteConfirmText("");
  }

  async function syncSolanaWallet(p: PlatformRow) {
    if (!looksLikeSolanaAddress(p.walletAddress)) {
      toast.error("Adresse Solana manquante ou invalide sur cette plateforme");
      return;
    }
    setMenuOpenId(null);
    setSolanaLoadingId(p.id);
    try {
      const res = await fetchJson<{
        ok: boolean;
        snapshot: SolanaPortfolioSnapshot;
        ledgerWritten?: boolean;
        ledgerError?: string | null;
        ledger?: {
          assetsTouched: number;
          txsCreated: number;
        } | null;
        txSync?: {
          newTransactions: number;
          fetchedSignatures: number;
          initial: boolean;
          truncated: boolean;
          notice?: string | null;
        } | null;
      }>("/api/wallets/solana/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId: p.id,
          // Filet : adresse saisie / stockée, évite NO_WALLET si lecture DB stale
          address: p.walletAddress,
          writeLedger: true,
          syncTransactions: true,
        }),
      });
      setSolanaSnaps((prev) => ({ ...prev, [p.id]: res.snapshot }));
      const txPart =
        res.txSync && res.txSync.newTransactions > 0
          ? ` · ${res.txSync.newTransactions} tx on-chain`
          : res.txSync && res.txSync.fetchedSignatures > 0
            ? ` · ${res.txSync.fetchedSignatures} sig. lues`
            : res.txSync?.initial
              ? ` · historique RPC`
              : res.txSync?.notice
                ? ` · ${res.txSync.notice}`
                : "";
      if (res.ledgerWritten && res.ledger) {
        toast.success(
          `Wallet Solana (RPC) · ${res.ledger.assetsTouched} position(s)` +
            (res.ledger.txsCreated
              ? ` · ${res.ledger.txsCreated} ajustement(s)`
              : "") +
            txPart
        );
        onUpdated?.();
      } else if (res.ledgerError) {
        toast.message(
          `Snapshot RPC OK, positions non écrites : ${res.ledgerError}${txPart}`
        );
      } else {
        const n =
          (res.snapshot.native ? 1 : 0) + (res.snapshot.tokens?.length ?? 0);
        toast.success(`Snapshot Solana RPC · ${n} actif(s)${txPart}`);
      }
      setSolanaDetail({ platform: p, snapshot: res.snapshot });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Échec lecture wallet Solana"
      );
    } finally {
      setSolanaLoadingId(null);
    }
  }

  /** Sync générique : Solana RPC ou Zerion EVM (toute blockchain avec adresse). */
  async function syncChainWallet(p: PlatformRow) {
    const addr = (p.walletAddress || "").trim();
    if (!addr) {
      toast.error("Adresse publique manquante sur cette plateforme");
      return;
    }
    if (looksLikeSolanaAddress(addr)) {
      await syncSolanaWallet(p);
      return;
    }
    const cap = resolveChainSyncForPlatform({
      logoKey: p.logoKey,
      name: p.name,
      type: p.type,
    });
    const path =
      cap?.syncPath ||
      (p.type === "BLOCKCHAIN" ? "/api/wallets/zerion/sync" : null);
    if (!path) {
      toast.error("Synchronisation non disponible pour cette plateforme");
      return;
    }
    setMenuOpenId(null);
    setSolanaLoadingId(p.id);
    try {
      const res = await fetchJson<{
        ok?: boolean;
        message?: string;
        ledgerError?: string | null;
        ledgerWritten?: boolean;
        assetsTouched?: number;
        txsCreated?: number;
        positions?: number;
        transactionsImported?: number;
        historyTruncated?: boolean;
        historyTruncatedMessage?: string | null;
        summary?: {
          assetsTouched?: number;
          balances?: number;
          transactions?: number;
          ledgerTxs?: number;
          historyTxs?: number;
          historyTruncated?: boolean;
        };
        ledger?: { assetsTouched?: number; txsCreated?: number };
        history?: { historyTxsCreated?: number };
        portfolio?: {
          balances?: unknown[];
          transactions?: unknown[];
        };
      }>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId: p.id,
          address: addr,
          writeLedger: true,
          syncTransactions: true,
          // Filtre chaîne plateforme (évite de fusionner toutes les EVM)
          allChains: false,
          chainPreset: p.logoKey || cap?.presetKey,
          apiKey: (p as { walletApiKey?: string | null }).walletApiKey || undefined,
        }),
      });
      const pos =
        res.summary?.assetsTouched ??
        res.ledger?.assetsTouched ??
        res.assetsTouched ??
        res.positions ??
        0;
      const txs =
        res.summary?.historyTxs ??
        res.history?.historyTxsCreated ??
        res.txsCreated ??
        res.transactionsImported ??
        0;
      const nBal =
        res.summary?.balances ?? res.portfolio?.balances?.length ?? 0;
      const nApiTx =
        res.summary?.transactions ?? res.portfolio?.transactions?.length ?? 0;
      // Pas de faux succès : ledgerError / zéro résultat → message neutre
      if (res.ledgerError) {
        toast.message(
          `Wallet · ${nBal || pos} solde(s) API · ledger : ${res.ledgerError}`
        );
      } else if (pos === 0 && txs === 0 && nBal === 0 && nApiTx === 0) {
        toast.message(
          res.message ||
            "Synchronisation OK — aucun solde / transaction pour cette adresse"
        );
      } else {
        toast.success(
          res.message ||
            `Wallet synchronisé · ${pos} position(s)` +
              (txs ? ` · ${txs} tx historique` : "")
        );
      }
      const truncated = Boolean(
        res.historyTruncated ?? res.summary?.historyTruncated
      );
      setHistoryTruncatedByPlatform((prev) => ({
        ...prev,
        [p.id]: truncated,
      }));
      if (truncated) {
        toast.message(
          res.historyTruncatedMessage ||
            "Historique limité aux 800 dernières transactions. Pour un historique complet, importez un CSV depuis votre exchange.",
          { duration: 10_000 }
        );
      }
      onUpdated?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Échec synchronisation wallet"
      );
    } finally {
      setSolanaLoadingId(null);
    }
  }

  return (
    <section className="space-y-4" data-testid="platforms-tab">
      <header className="flex flex-wrap items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="text-title">Mes plateformes</h2>
          <p className="module-intro text-meta">
            Synthèse des courtiers, banques et exchanges utilisés dans vos
            transactions
          </p>
        </div>
        {platforms.length > 0 && (
          <span className="text-meta tabular-nums">
            {sorted.length === platforms.length
              ? `${platforms.length} plateforme${platforms.length !== 1 ? "s" : ""}`
              : `${sorted.length} / ${platforms.length}`}
          </span>
        )}
      </header>

      <div
        className={cn(
          "flex min-w-0 flex-col gap-2.5",
          "sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
        )}
        data-testid="platforms-toolbar"
      >
        <div
          className={cn(
            "flex min-w-0 w-full flex-col gap-2",
            "sm:w-auto sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5"
          )}
        >
          <TableFilters
            className="min-w-0 w-full sm:min-w-[14rem] sm:max-w-md sm:flex-1"
            search={search}
            onSearchChange={setSearch}
            showAccountFilter={false}
            searchFirst
            placeholder="Rechercher une plateforme…"
          />
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="shrink-0 font-medium text-[var(--muted-foreground)]">
              Type
            </span>
            <select
              className="input !w-full min-w-0 !py-1.5 text-sm sm:!w-auto sm:min-w-[11rem]"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="platforms-type-filter"
              aria-label="Filtrer par type de plateforme"
            >
              <option value="ALL">Tous ({platforms.length})</option>
              {typesPresent.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)} (
                  {platforms.filter((p) => p.type === t).length})
                </option>
              ))}
            </select>
          </label>
        </div>
        {onAddPlatform && (
          <Button
            size="sm"
            onClick={onAddPlatform}
            className="w-full shrink-0 sm:w-auto"
            data-testid="platforms-add-platform"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter une plateforme
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div
          className="card p-8 text-center"
          data-testid="platforms-empty-state"
        >
          <p className="text-sm font-medium text-[var(--foreground)]">
            {platforms.length === 0
              ? "Aucune plateforme pour l’instant"
              : "Aucun résultat pour ces filtres"}
          </p>
          <p className="text-meta mx-auto mt-1.5 max-w-sm">
            {platforms.length === 0
              ? "Ajoutez un courtier, une banque, un exchange ou un wallet blockchain. Vous pourrez ensuite importer un CSV ou saisir des transactions."
              : "Modifiez la recherche ou le type."}
          </p>
          {platforms.length === 0 && onAddPlatform && (
            <Button
              size="sm"
              className="mt-4"
              onClick={onAddPlatform}
              data-testid="platforms-empty-cta"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter une plateforme
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => {
            const total = p.totalValueBase || p.totalValueEur || p.cashBase || p.cashEur;
            const posCount = p.positionCount ?? 0;
            return (
              <article
                key={p.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(p.id, el);
                  else cardRefs.current.delete(p.id);
                }}
                tabIndex={0}
                aria-label={`${p.name} — Entrée ou double-clic pour l’aperçu`}
                className={cn(
                  "card group relative flex flex-col p-4 transition outline-none",
                  "hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-xs)]",
                  "focus-visible:ring-2 focus-visible:ring-teal-600/40"
                )}
                data-testid={`platform-${p.name}`}
                onDoubleClick={(e) => {
                  // éviter double-clic sur menu / boutons internes
                  if ((e.target as HTMLElement).closest("button,a,input")) return;
                  openPreview(p);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openPreview(p);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <PlatformLogo src={p.logoUrl} name={p.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold tracking-tight text-[var(--foreground)]">
                      {p.name}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
                        )}
                      >
                        {typeLabel(p.type)}
                      </span>
                      {p.subtype && (
                        <span className="inline-flex rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                          {p.subtype}
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    className="relative shrink-0"
                    ref={menuOpenId === p.id ? menuRef : undefined}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-[var(--muted-foreground)] opacity-70 transition group-hover:opacity-100"
                      title="Actions"
                      aria-label={`Actions pour ${p.name}`}
                      aria-expanded={menuOpenId === p.id}
                      data-testid={`platform-menu-${p.id}`}
                      onClick={() =>
                        setMenuOpenId((id) => (id === p.id ? null : p.id))
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                    {menuOpenId === p.id && (
                      <div
                        className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--muted)]"
                          data-testid={`preview-platform-${p.id}`}
                          onClick={() => openPreview(p)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Aperçu rapide
                        </button>
                        {onNewTransaction && (
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--muted)]"
                            data-testid={`new-tx-platform-${p.id}`}
                            onClick={() => {
                              setMenuOpenId(null);
                              onNewTransaction(p);
                            }}
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Nouvelle transaction
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--muted)]"
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Enrichir
                        </button>
                        {platforms.length > 1 && (
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--muted)]"
                            data-testid={`merge-platform-${p.id}`}
                            onClick={() => openMerge(p)}
                          >
                            <GitMerge className="h-3.5 w-3.5" />
                            Fusionner…
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                            data-testid={`delete-platform-${p.id}`}
                            disabled={deletePendingId === p.id}
                            onClick={() => handleDelete(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Supprimer
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-[var(--muted)]/40 px-2 py-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      Positions
                    </p>
                    <p className="mt-0.5 font-semibold tabular-nums">
                      {posCount}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[var(--muted)]/40 px-2 py-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      Dernière op.
                    </p>
                    <p className="mt-0.5 truncate font-medium">
                      {formatLastTx(p.lastTransactionAt)}
                    </p>
                  </div>
                </div>

                {p.walletAddress && (
                  <p
                    className="mt-2 truncate font-mono text-[10px] text-[var(--muted-foreground)]"
                    title={p.walletAddress}
                  >
                    {shortAddr(p.walletAddress)}
                  </p>
                )}

                {/* Sync wallet : Solana RPC ou EVM/Zerion si adresse publique */}
                {Boolean(p.walletAddress?.trim()) &&
                  (p.type === "BLOCKCHAIN" ||
                    looksLikeSolanaAddress(p.walletAddress) ||
                    resolveChainSyncForPlatform({
                      logoKey: p.logoKey,
                      name: p.name,
                      type: p.type,
                    })) && (
                  <div className="mt-2 space-y-1.5">
                    {looksLikeSolanaAddress(p.walletAddress) &&
                      solanaSnaps[p.id] && (
                      <button
                        type="button"
                        className="w-full rounded-lg border border-violet-200/80 bg-violet-50/80 px-2 py-1.5 text-left transition hover:bg-violet-100/80 dark:border-violet-900 dark:bg-violet-950/40 dark:hover:bg-violet-950/70"
                        onClick={() =>
                          setSolanaDetail({
                            platform: p,
                            snapshot: solanaSnaps[p.id],
                          })
                        }
                        data-testid={`solana-snapshot-${p.id}`}
                      >
                        <p className="text-[10px] font-medium uppercase tracking-wide text-violet-800 dark:text-violet-200">
                          On-chain (RPC Solana)
                        </p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums text-violet-950 dark:text-violet-100">
                          {formatUsd(solanaSnaps[p.id].totalValueUsd)}
                          <span className="ml-1 text-[10px] font-normal text-violet-700/80 dark:text-violet-300/80">
                            USD · hors ledger
                          </span>
                        </p>
                      </button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={solanaLoadingId === p.id}
                      onClick={() => void syncChainWallet(p)}
                      data-testid={
                        looksLikeSolanaAddress(p.walletAddress)
                          ? `solana-sync-${p.id}`
                          : `chain-sync-${p.id}`
                      }
                    >
                      <RefreshCw
                        className={cn(
                          "h-3.5 w-3.5",
                          solanaLoadingId === p.id && "animate-spin"
                        )}
                      />
                      {solanaLoadingId === p.id
                        ? "Sync…"
                        : looksLikeSolanaAddress(p.walletAddress) &&
                            solanaSnaps[p.id]
                          ? "Rafraîchir + txs"
                          : "Lire wallet + txs"}
                    </Button>
                    {historyTruncatedByPlatform[p.id] && (
                      <p
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-950 dark:text-amber-100"
                        data-testid={`history-truncated-notice-${p.id}`}
                      >
                        Historique limité aux 800 dernières transactions. Pour
                        un historique complet, importez un CSV depuis votre
                        exchange.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-auto border-t border-[var(--border)] pt-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    Valeur totale
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-teal-800 dark:text-teal-300">
                    {formatCurrency(total, baseCurrency)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                    Cash{" "}
                    {formatCurrency(p.cashBase || p.cashEur, baseCurrency)}
                    {p.positionsValueBase != null && (
                      <>
                        {" "}
                        · Titres{" "}
                        {formatCurrency(
                          p.positionsValueBase || p.positionsValueEur || "0",
                          baseCurrency
                        )}
                      </>
                    )}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Enrichissement optionnel */}
      {editTarget && (
        <Modal
          title={`Enrichir · ${editTarget.name}`}
          onClose={() => setEditTarget(null)}
          panelClassName="max-w-md"
        >
          <form className="space-y-3" onSubmit={saveEdit}>
            <Field label="Nom">
              <input
                className="input w-full"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </Field>
            <Field label="Type">
              <select
                className="input w-full"
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
              >
                {TYPE_OPTIONS.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="URL du logo">
              <div className="flex items-center gap-2">
                <PlatformLogo
                  src={editLogo || editTarget.logoUrl}
                  name={editName}
                  size={32}
                />
                <input
                  className="input min-w-0 flex-1"
                  value={editLogo}
                  onChange={(e) => setEditLogo(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </Field>
            {(editType === "BLOCKCHAIN" ||
              editTarget.type === "BLOCKCHAIN" ||
              Boolean(editTarget.walletAddress) ||
              Boolean(editWallet)) &&
              (() => {
                const cap = resolveChainSyncForPlatform({
                  name: editName || editTarget.name,
                  type: editType,
                  logoKey: editTarget.logoKey,
                });
                return (
                  <div className="space-y-2">
                    <Field
                      label={
                        cap?.provider === "monero-manual"
                          ? "Adresse (optionnel)"
                          : "Adresse (Public Address / Wallet)"
                      }
                    >
                      <input
                        className="input w-full font-mono text-sm"
                        value={editWallet}
                        onChange={(e) => setEditWallet(e.target.value)}
                        placeholder={
                          cap?.addressHint || "Adresse publique on-chain"
                        }
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="platform-edit-wallet"
                      />
                    </Field>
                    {cap?.provider === "zerion" && (
                      <Field label="Clé API Zerion">
                        <input
                          className="input w-full font-mono text-sm"
                          value={editApiKey}
                          onChange={(e) => setEditApiKey(e.target.value)}
                          placeholder="zk_…"
                          autoComplete="off"
                          spellCheck={false}
                          data-testid="platform-edit-api-key"
                        />
                      </Field>
                    )}
                    {cap?.provider === "monero-manual" && (
                      <Field label="Solde XMR (saisie locale)">
                        <input
                          className="input w-full font-mono text-sm"
                          value={editMoneroAmount}
                          onChange={(e) => setEditMoneroAmount(e.target.value)}
                          placeholder="ex. 12.5"
                          inputMode="decimal"
                          data-testid="platform-edit-monero-amount"
                        />
                      </Field>
                    )}
                    {cap?.provider === "zerion" && (
                      <p
                        className="text-[11px] leading-relaxed text-[var(--muted-foreground)]"
                        data-testid="platform-edit-zerion-help"
                      >
                        {ZERION_HELP_MESSAGE}
                      </p>
                    )}
                    {cap?.provider === "monero-manual" && cap.helpMessage && (
                      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                        {cap.helpMessage}
                      </p>
                    )}
                  </div>
                );
              })()}
            {editType === "BLOCKCHAIN" &&
              (() => {
                const cap = resolveChainSyncForPlatform({
                  name: editName || editTarget.name,
                  type: editType,
                  logoKey: editTarget.logoKey,
                });
                if (cap) {
                  return (
                    <div
                      className="rounded-lg border border-emerald-400/60 bg-emerald-50 px-2.5 py-2 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40"
                      data-testid="platform-edit-api-ready"
                    >
                      <p className="font-semibold text-emerald-950 dark:text-emerald-50">
                        {availableApiStatusMessage()}
                      </p>
                      <p className="mt-0.5 text-emerald-900/90 dark:text-emerald-100/90">
                        {describeChainSyncFeatures(cap)}
                      </p>
                    </div>
                  );
                }
                return (
                  <div
                    className="rounded-lg border border-amber-400/70 bg-amber-50 px-2.5 py-2 text-[11px] dark:border-amber-700 dark:bg-amber-950/50"
                    data-testid="platform-edit-api-missing"
                  >
                    <p className="font-semibold text-amber-950 dark:text-amber-50">
                      {missingApiStatusMessage()}
                    </p>
                  </div>
                );
              })()}
            <Field label="Notes">
              <textarea
                className="input min-h-[4rem] w-full"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Optionnel"
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditTarget(null)}
              >
                Annuler
              </Button>
              {editType === "BLOCKCHAIN" &&
                resolveChainSyncForPlatform({
                  name: editName || editTarget.name,
                  type: editType,
                  logoKey: editTarget.logoKey,
                })?.syncPath && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={editSaving || editSyncing}
                    onClick={() => void syncFromEdit()}
                    data-testid="platform-edit-sync"
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        editSyncing && "animate-spin"
                      )}
                    />
                    {editSyncing ? "Synchro…" : "Synchroniser"}
                  </Button>
                )}
              <Button type="submit" size="sm" disabled={editSaving || editSyncing}>
                {editSaving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Aperçu rapide plateforme */}
      {previewTarget && (
        <Modal
          title={`Aperçu · ${previewTarget.name}`}
          onClose={() => setPreviewTarget(null)}
          panelClassName="max-w-md"
          testId="platform-preview-modal"
        >
          <div className="space-y-3" data-testid="platform-preview">
            <div className="flex items-start gap-3">
              <PlatformLogo
                src={previewTarget.logoUrl}
                name={previewTarget.name}
                size={44}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">
                  {previewTarget.name}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {typeLabel(previewTarget.type)}
                  {previewTarget.subtype ? ` · ${previewTarget.subtype}` : ""}
                </p>
                {previewTarget.walletAddress && (
                  <p
                    className="mt-1 break-all font-mono text-[10px] text-[var(--muted-foreground)]"
                    title={previewTarget.walletAddress}
                  >
                    {previewTarget.walletAddress}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-lg bg-[var(--muted)]/50 px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Positions ouvertes
                </p>
                <p className="mt-0.5 text-base font-semibold tabular-nums">
                  {previewTarget.positionCount ?? 0}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--muted)]/50 px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Dernière opération
                </p>
                <p className="mt-0.5 font-medium">
                  {formatLastTx(previewTarget.lastTransactionAt)}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--muted)]/50 px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Cash
                </p>
                <p className="mt-0.5 font-semibold tabular-nums">
                  {formatCurrency(
                    previewTarget.cashBase || previewTarget.cashEur,
                    baseCurrency
                  )}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--muted)]/50 px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Valeur titres
                </p>
                <p className="mt-0.5 font-semibold tabular-nums">
                  {formatCurrency(
                    previewTarget.positionsValueBase ||
                      previewTarget.positionsValueEur ||
                      "0",
                    baseCurrency
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Valeur totale (cash + titres)
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-teal-800 dark:text-teal-300">
                {formatCurrency(
                  previewTarget.totalValueBase ||
                    previewTarget.totalValueEur ||
                    previewTarget.cashBase ||
                    "0",
                  baseCurrency
                )}
              </p>
            </div>

            {previewTarget.notes && (
              <p className="rounded-md bg-[var(--muted)]/40 px-2.5 py-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                {previewTarget.notes}
              </p>
            )}

            {solanaSnaps[previewTarget.id] && (
              <button
                type="button"
                className="w-full rounded-lg border border-violet-200/80 bg-violet-50/80 px-2.5 py-2 text-left text-[11px] dark:border-violet-900 dark:bg-violet-950/40"
                onClick={() => {
                  setSolanaDetail({
                    platform: previewTarget,
                    snapshot: solanaSnaps[previewTarget.id],
                  });
                }}
              >
                Snapshot on-chain :{" "}
                <strong>
                  {formatUsd(solanaSnaps[previewTarget.id].totalValueUsd)}
                </strong>{" "}
                USD (hors ledger)
              </button>
            )}

            <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row sm:flex-wrap sm:justify-end">
              {onNewTransaction && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  data-testid="platform-preview-new-tx"
                  onClick={() => {
                    const p = previewTarget;
                    setPreviewTarget(null);
                    onNewTransaction(p);
                  }}
                >
                  <Receipt className="h-3.5 w-3.5" />
                  Nouvelle transaction
                </Button>
              )}
              {onViewPositions && (
                <Button
                  type="button"
                  size="sm"
                  className="w-full sm:w-auto"
                  data-testid="platform-preview-positions"
                  onClick={() => {
                    const p = previewTarget;
                    setPreviewTarget(null);
                    onViewPositions(p);
                  }}
                >
                  <LayoutList className="h-3.5 w-3.5" />
                  Voir dans Positions
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setPreviewTarget(null)}
              >
                Fermer
              </Button>
            </div>
            <p className="text-center text-[10px] text-[var(--muted-foreground)] sm:text-left">
              Astuce : double-clic sur une carte, Entrée au focus, ou menu ⋯ →
              Aperçu rapide
            </p>
          </div>
        </Modal>
      )}

      {/* Snapshot Solana lecture seule */}
      {solanaDetail && (
        <Modal
          title={`Wallet Solana · ${solanaDetail.platform.name}`}
          onClose={() => setSolanaDetail(null)}
          panelClassName="max-w-lg"
        >
          <div className="space-y-3" data-testid="solana-detail-modal">
            <div className="flex items-start gap-2 rounded-lg bg-violet-50/80 px-3 py-2 text-[11px] leading-relaxed text-violet-950 dark:bg-violet-950/40 dark:text-violet-100">
              <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Snapshot + <strong>historique on-chain</strong> via RPC Solana
                (@solana/web3.js). Soldes → patrimoine ; txs → journal (date =
                blockTime). Montants en <strong>USD</strong> si prix connu.
              </p>
            </div>
            {solanaDetail.snapshot.notice && (
              <p className="rounded-md border border-amber-200/80 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                {solanaDetail.snapshot.notice}
              </p>
            )}
            <p className="break-all font-mono text-[11px] text-[var(--muted-foreground)]">
              {solanaDetail.snapshot.address}
            </p>
            <div className="rounded-lg border border-[var(--border)] px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Valeur estimée on-chain
              </p>
              <p className="text-xl font-semibold tabular-nums tracking-tight">
                {formatUsd(solanaDetail.snapshot.totalValueUsd)}
              </p>
              <p className="text-[10px] text-[var(--muted-foreground)]">
                Mis à jour{" "}
                {new Date(solanaDetail.snapshot.fetchedAt).toLocaleString(
                  "fr-FR"
                )}
              </p>
            </div>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {solanaDetail.snapshot.native && (
                <li className="flex items-center justify-between gap-2 rounded-md bg-[var(--muted)]/50 px-2.5 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate font-medium">
                    {solanaDetail.snapshot.native.symbol}
                    <span className="ml-1 font-normal text-[var(--muted-foreground)]">
                      (natif)
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-right">
                    {formatTokenQty(solanaDetail.snapshot.native.balance)}
                    <span className="ml-2 text-[var(--muted-foreground)]">
                      {formatUsd(solanaDetail.snapshot.native.valueUsd)}
                    </span>
                  </span>
                </li>
              )}
              {solanaDetail.snapshot.tokens.map((t) => (
                <li
                  key={t.tokenAddress || t.symbol}
                  className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12px] hover:bg-[var(--muted)]/40"
                >
                  <span className="min-w-0 truncate font-medium" title={t.name}>
                    {t.symbol}
                  </span>
                  <span className="shrink-0 tabular-nums text-right">
                    {formatTokenQty(t.balance)}
                    <span className="ml-2 text-[var(--muted-foreground)]">
                      {formatUsd(t.valueUsd)}
                    </span>
                  </span>
                </li>
              ))}
              {!solanaDetail.snapshot.native &&
                solanaDetail.snapshot.tokens.length === 0 && (
                  <li className="px-2 py-4 text-center text-[12px] text-[var(--muted-foreground)]">
                    Aucun solde token détecté
                  </li>
                )}
            </ul>

            <div className="rounded-lg border border-[var(--border)] px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Transactions on-chain
                {onchainTxs.length > 0 ? ` · ${onchainTxs.length}` : ""}
              </p>
              {onchainTxsLoading ? (
                <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                  Chargement…
                </p>
              ) : onchainTxs.length === 0 ? (
                <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                  Aucune tx encore — cliquez « Rafraîchir » pour les récupérer
                  (RPC).
                </p>
              ) : (
                <ul
                  className="mt-2 max-h-48 space-y-1 overflow-y-auto"
                  data-testid="solana-onchain-txs"
                >
                  {onchainTxs.map((tx) => {
                    const legs = (tx.transfers || [])
                      .slice(0, 2)
                      .map((t) => {
                        const sym =
                          t.symbol ||
                          (t.kind === "SOL" ? "SOL" : "SPL");
                        return `${t.direction === "in" ? "+" : t.direction === "out" ? "−" : ""}${Number(t.amount).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} ${sym}`;
                      })
                      .join(" · ");
                    return (
                      <li
                        key={tx.signature}
                        className="flex items-start justify-between gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-[var(--muted)]/40"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">
                            {tx.type || "TX"}
                            <span className="ml-1.5 font-normal text-[var(--muted-foreground)]">
                              {tx.blockTime
                                ? new Date(tx.blockTime).toLocaleString(
                                    "fr-FR",
                                    {
                                      day: "2-digit",
                                      month: "short",
                                      year: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }
                                  )
                                : "—"}
                            </span>
                          </p>
                          <p
                            className="truncate font-mono text-[10px] text-[var(--muted-foreground)]"
                            title={tx.signature}
                          >
                            {tx.signature.slice(0, 8)}…{tx.signature.slice(-6)}
                            {legs ? ` · ${legs}` : ""}
                          </p>
                        </div>
                        <a
                          href={`https://solscan.io/tx/${tx.signature}`}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-[10px] text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Solscan
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={solanaLoadingId === solanaDetail.platform.id}
                onClick={() => void syncSolanaWallet(solanaDetail.platform)}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    solanaLoadingId === solanaDetail.platform.id &&
                      "animate-spin"
                  )}
                />
                Rafraîchir + txs
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setSolanaDetail(null)}
              >
                Fermer
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Suppression plateforme (cascade) */}
      {deleteTarget && (
        <Modal
          title={`Supprimer « ${deleteTarget.name} »`}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteConfirmChecked(false);
            setDeleteConfirmText("");
          }}
          panelClassName="max-w-md"
        >
          <div className="space-y-3" data-testid="platform-delete-modal">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-50">
              <p className="font-semibold">Action irréversible</p>
              <p className="mt-1">
                Cette action supprimera définitivement la plateforme{" "}
                <strong>{deleteTarget.name}</strong>,{" "}
                <strong>toutes les transactions</strong> qui y sont rattachées
                (source ou destination), ainsi que les{" "}
                <strong>actifs / positions</strong> liés. Aucune récupération
                possible.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-[var(--foreground)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteConfirmChecked}
                onChange={(e) => setDeleteConfirmChecked(e.target.checked)}
                data-testid="platform-delete-confirm-check"
              />
              <span>
                Je comprends que cette action est définitive et que toutes les
                transactions attachées seront effacées.
              </span>
            </label>

            <label className="block text-[11px] text-red-900/90 dark:text-red-100/85">
              <span className="mb-1 block font-medium">
                Pour confirmer, saisissez{" "}
                <kbd className="rounded bg-red-100 px-1 font-mono text-[10px] dark:bg-red-950">
                  {DELETE_CONFIRM_WORD}
                </kbd>
              </span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                className="input !border-red-200 !bg-white !py-1.5 text-sm dark:!border-red-900/50 dark:!bg-[var(--input-bg)]"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRM_WORD}
                data-testid="platform-delete-confirm-input"
                aria-label={`Saisir ${DELETE_CONFIRM_WORD} pour confirmer`}
              />
            </label>

            <div className="flex flex-col gap-1.5 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmChecked(false);
                  setDeleteConfirmText("");
                }}
                data-testid="platform-delete-cancel"
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={!canForceDelete || deletePendingId === deleteTarget.id}
                data-testid="platform-delete-confirm"
                onClick={() => {
                  if (!onDelete || !canForceDelete) return;
                  onDelete(deleteTarget, { force: true });
                  setDeleteTarget(null);
                  setDeleteConfirmChecked(false);
                  setDeleteConfirmText("");
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletePendingId === deleteTarget.id
                  ? "Suppression…"
                  : "SUPPRIMER"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Fusion doublons */}
      {mergeSource && (
        <Modal
          title="Fusionner des plateformes"
          onClose={() => setMergeSource(null)}
          panelClassName="max-w-md"
        >
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              Transférer tout le contenu de{" "}
              <strong className="text-[var(--foreground)]">
                {mergeSource.name}
              </strong>{" "}
              vers la plateforme cible, puis supprimer la source.
            </p>
            <Field label="Plateforme source (sera supprimée)">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
                <PlatformLogo
                  src={mergeSource.logoUrl}
                  name={mergeSource.name}
                  size={24}
                />
                <span className="text-sm font-medium">{mergeSource.name}</span>
              </div>
            </Field>
            <Field label="Plateforme cible (conservée)">
              <select
                className="input w-full"
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                data-testid="merge-target-select"
              >
                <option value="">Choisir…</option>
                {platforms
                  .filter((p) => p.id !== mergeSource.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMergeSource(null)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!mergeTargetId || mergePending}
                onClick={() => void runMerge()}
                data-testid="merge-confirm"
              >
                {mergePending ? "Fusion…" : "Fusionner"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

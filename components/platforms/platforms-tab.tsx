"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2, Upload, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { matchesSearchQuery } from "@/components/ui/table-filters";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { PLATFORM_TYPES } from "@/app/lib/constants";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { formatCurrency, cn } from "@/app/lib/utils";
import { KpiCardTile } from "@/components/ui/kpi-tiles";
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
import {
  comparePlatforms,
  parsePlatformSortMode,
  type PlatformSortMode,
} from "@/app/lib/platforms/sort";
import {
  buildPlatformViews,
  computePlatformsOverview,
  matchesStatusFilter,
  platformSearchFields,
  type PlatformStatusFilter,
  type PlatformView,
} from "@/app/lib/platforms/connection";
import { PlatformList } from "./platform-list";
import { PlatformPanel } from "./platform-panel";

const STATUS_FILTERS: Array<{ id: PlatformStatusFilter; label: string }> = [
  { id: "ALL", label: "Toutes" },
  { id: "ATTENTION", label: "À traiter" },
  { id: "SYNCED", label: "Synchronisées" },
  { id: "MANUAL", label: "Manuelles" },
];


/** Base58 Solana (aligné côté serveur) — pas d’appel API si EVM. */
function looksLikeSolanaAddress(addr: string | null | undefined): boolean {
  const a = (addr || "").trim();
  if (!a || a.startsWith("0x") || a.startsWith("0X")) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
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
  onImportForPlatform,
  onViewTransactions,
  loading,
}: {
  /**
   * Chargement de la liste en cours.
   *
   * Sans cette information, une liste encore vide est indiscernable d'un
   * compte sans plateforme : l'écran annonçait « Aucune plateforme » le temps
   * de la requête, ce qui est faux et alarmant.
   */
  loading?: boolean;
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
  /** Ouvre l'import CSV avec cette plateforme préselectionnée. */
  onImportForPlatform?: (platform: PlatformRow) => void;
  /** Ouvre Transactions avec filtre plateforme. */
  onViewTransactions?: (platform: PlatformRow) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<PlatformStatusFilter>("ALL");
  const [sortMode, setSortMode] = useState<PlatformSortMode>("value");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  /**
   * Horloge figée au montage.
   *
   * L'ancienneté d'une synchronisation se compare à un instant, et lire
   * `Date.now()` pendant le rendu rendrait celui-ci impur. Une plateforme ne
   * bascule pas de « à jour » à « ancienne » pendant qu'on la regarde.
   */
  const [clock] = useState(() => new Date());

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

  /** Plateformes en cours de synchro (Solana RPC ou Zerion EVM) — un Set, pas
   * un seul id, pour permettre des syncs parallèles sur deux plateformes
   * différentes sans que l'une écrase visuellement l'état de l'autre. */
  const [syncingPlatformIds, setSyncingPlatformIds] = useState<Set<string>>(
    () => new Set()
  );
  function markSyncing(id: string, syncing: boolean) {
    setSyncingPlatformIds((prev) => {
      const next = new Set(prev);
      if (syncing) next.add(id);
      else next.delete(id);
      return next;
    });
  }
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

  // Vide la liste dès que la plateforme sélectionnée n'a plus d'id Solana,
  // et arme le loading dès qu'un (re)fetch va démarrer (adjust state while rendering).
  const solanaPlatformId = solanaDetail?.platform.id ?? null;
  const solanaFetchKey = `${solanaPlatformId}:${solanaDetail?.snapshot.fetchedAt ?? ""}`;
  const [prevSolanaFetchKey, setPrevSolanaFetchKey] = useState(solanaFetchKey);
  if (solanaFetchKey !== prevSolanaFetchKey) {
    setPrevSolanaFetchKey(solanaFetchKey);
    if (solanaPlatformId) setOnchainTxsLoading(true);
    else setOnchainTxs([]);
  }

  useEffect(() => {
    if (!solanaDetail?.platform.id) return;
    let cancelled = false;
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

  const typesPresent = useMemo(() => {
    const set = new Set(platforms.map((p) => p.type));
    return [...set].sort((a, b) => {
      const la = typeLabel(a);
      const lb = typeLabel(b);
      return la.localeCompare(lb, "fr");
    });
  }, [platforms]);

  const views = useMemo(
    () => buildPlatformViews(platforms, clock),
    [platforms, clock]
  );

  /*
    La synthèse porte sur **toutes** les plateformes, jamais sur la sélection
    filtrée : un compteur « à traiter » qui tomberait à zéro parce qu'on a
    filtré sur « synchronisées » ne signalerait plus rien.
  */
  const overview = useMemo(() => computePlatformsOverview(views), [views]);

  const visible = useMemo(() => {
    const list = views
      .filter((v) => typeFilter === "ALL" || v.type === typeFilter)
      .filter((v) => matchesStatusFilter(v, statusFilter))
      .filter((v) => matchesSearchQuery(debouncedSearch, platformSearchFields(v)));
    return list.sort((a, b) => comparePlatforms(a.row, b.row, sortMode));
  }, [views, typeFilter, statusFilter, debouncedSearch, sortMode]);

  /*
    La sélection est cherchée dans les lignes **visibles**, pas dans toutes.

    Une plateforme masquée par un filtre ne peut pas rester affichée à droite :
    le panneau montrerait un détail que la table ne contient plus. La dériver
    ainsi, plutôt que de remettre l'état à zéro dans un effet, évite un rendu
    en cascade et retrouve naturellement la sélection si le filtre est annulé.
  */
  const showSkeleton = Boolean(loading) && platforms.length === 0;

  const selected: PlatformView | null =
    visible.find((v) => v.id === selectedId) ?? null;

  const historyTruncatedPlatform =
    views.find((v) => historyTruncatedByPlatform[v.id]) ?? null;

  function openEdit(p: PlatformRow) {
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
    // Le secret n'est jamais renvoyé par le serveur — champ vide par défaut ;
    // `hasWalletApiKey` alimente juste un hint dans le placeholder (voir JSX).
    setEditApiKey(cap?.defaultApiKey || "");
    setEditMoneroAmount("");
  }

  function openMerge(p: PlatformRow) {
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
          // Champ vide = ne pas toucher à la clé déjà enregistrée (jamais
          // renvoyée par le serveur, donc jamais "vide" pour une vraie mise à
          // jour) — omis plutôt que null, sinon on écraserait la clé existante.
          ...(apiKey.length > 0 ? { walletApiKey: apiKey } : {}),
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
          // Vide = ne pas toucher à la clé déjà enregistrée (voir saveEdit)
          walletApiKey:
            cap.provider === "zerion" && apiKey.length > 0
              ? apiKey
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
    // La modale de fusion (bouton "Fusionner") est déjà la confirmation —
    // ce window.confirm() natif était redondant (double-prompt, bloquant,
    // ignore le thème, parfois bloqué en iframe/mobile).
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
    setDeleteTarget(p);
    setDeleteConfirmChecked(false);
    setDeleteConfirmText("");
  }

  async function syncSolanaWallet(p: PlatformRow) {
    if (!looksLikeSolanaAddress(p.walletAddress)) {
      toast.error("Adresse Solana manquante ou invalide sur cette plateforme");
      return;
    }
    markSyncing(p.id, true);
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
      markSyncing(p.id, false);
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
    markSyncing(p.id, true);
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
          // Pas de clé côté client à renvoyer : le serveur retombe sur celle
          // déjà enregistrée pour cette plateforme si `apiKey` est omis.
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
      markSyncing(p.id, false);
    }
  }
  return (
    <section className="space-y-[var(--space-4)]" data-testid="platforms-tab">
      <header className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="text-title">Plateformes</h1>
          <p className="text-meta mt-[var(--space-1)]">
            Vos comptes et connexions patrimoniales
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          {onImportForPlatform ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onImportForPlatform(selected?.row ?? platforms[0]!)}
              disabled={platforms.length === 0}
              data-testid="platforms-import"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Importer un relevé
            </Button>
          ) : null}
          {onAddPlatform ? (
            <Button
              size="sm"
              onClick={onAddPlatform}
              data-testid="platforms-add-platform"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Ajouter une plateforme
            </Button>
          ) : null}
        </div>
      </header>

      {/*
        Cinq indicateurs, tous adossés à une donnée réelle.

        Pas de « patrimoine couvert » en pourcentage : les plateformes ne
        portent ni immobilier, ni épargne salariale, ni actifs alternatifs.
        Rapporter leur somme au patrimoine net produirait un ratio
        systématiquement faux.
      */}
      <div
        className="grid grid-cols-2 gap-[var(--space-2)] sm:grid-cols-3 lg:grid-cols-5"
        data-testid="platforms-summary"
      >
        <KpiCardTile
          label="Plateformes"
          value={String(overview.platformCount)}
          hint={
            overview.dormantCount > 0
              ? `dont ${overview.dormantCount} sans mouvement`
              : "connectées"
          }
          testId="platforms-kpi-count"
        />
        <KpiCardTile
          label="Enveloppes"
          value={String(overview.envelopeCount)}
          hint={`${overview.positionCount} position${overview.positionCount > 1 ? "s" : ""}`}
          testId="platforms-kpi-envelopes"
        />
        <KpiCardTile
          label="Valeur suivie"
          value={formatCurrency(String(overview.totalValue), baseCurrency)}
          hint="espèces et titres"
          testId="platforms-summary-total"
        />
        <KpiCardTile
          label="Synchronisées"
          value={
            overview.syncableCount > 0
              ? `${overview.syncedCount}/${overview.syncableCount}`
              : "—"
          }
          hint={
            overview.syncableCount > 0
              ? "wallets à jour"
              : "aucun wallet connecté"
          }
          testId="platforms-kpi-synced"
        />
        <KpiCardTile
          label="À traiter"
          value={String(overview.attentionCount)}
          hint={
            overview.attentionCount > 0
              ? "action requise"
              : "rien à signaler"
          }
          tone={overview.attentionCount > 0 ? "warning" : undefined}
          testId="platforms-kpi-attention"
        />
      </div>

      <div className="panel">
        <div
          className="flex flex-wrap items-center gap-[var(--space-2)] border-b border-[var(--border)] p-[var(--space-3)]"
          data-testid="platforms-toolbar"
        >
          <input
            className="input min-w-[14rem] flex-1"
            placeholder="Rechercher une plateforme, un réseau, une enveloppe…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="platforms-search"
            aria-label="Rechercher une plateforme"
          />

          <div className="term-seg" role="group" aria-label="Filtrer par état">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="term-seg-item"
                data-active={statusFilter === f.id ? "true" : "false"}
                onClick={() => setStatusFilter(f.id)}
                data-testid={`platforms-status-${f.id.toLowerCase()}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            className="input w-auto"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            data-testid="platforms-type-filter"
            aria-label="Filtrer par nature"
          >
            <option value="ALL">Toutes natures</option>
            {typesPresent.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>

          <select
            className="input w-auto"
            value={sortMode}
            onChange={(e) => setSortMode(parsePlatformSortMode(e.target.value))}
            data-testid="platforms-sort-mode"
            aria-label="Trier"
          >
            <option value="value">Valeur</option>
            <option value="name">Nom</option>
            <option value="activity">Activité</option>
            <option value="positions">Positions</option>
            <option value="type">Nature</option>
          </select>
        </div>

        <div className="grid gap-[var(--space-4)] p-[var(--space-3)] xl:grid-cols-[minmax(0,1fr)_var(--panel-width)]">
          <div className="min-w-0">
            {showSkeleton ? (
              <div className="space-y-[var(--space-2)]" data-testid="platforms-skeleton">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[2.75rem] animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-hover)]"
                  />
                ))}
              </div>
            ) : platforms.length === 0 ? (
              /*
                État vide **local** : ne pas posséder de plateforme n'a rien à
                voir avec un compte vierge. Le cockpit d'accueil reste piloté
                par `isPatrimonyEmpty`, et n'a pas sa place ici.
              */
              <div
                className="asset-panel-empty py-[var(--space-8)]"
                data-testid="platforms-empty-state"
              >
                <p className="text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                  Aucune plateforme
                </p>
                <p className="text-meta max-w-[22rem]">
                  Ajoutez votre premier établissement pour centraliser votre
                  patrimoine, ou importez un relevé si vous partez d&apos;un fichier.
                </p>
                <div className="mt-[var(--space-3)] flex flex-wrap justify-center gap-[var(--space-2)]">
                  {onAddPlatform ? (
                    <Button
                      size="sm"
                      onClick={onAddPlatform}
                      data-testid="platforms-empty-cta"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Ajouter une plateforme
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div
                className="asset-panel-empty py-[var(--space-8)]"
                data-testid="platforms-no-match"
              >
                <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                  Aucune plateforme ne correspond
                </p>
                <p className="text-meta">Ajustez la recherche ou les filtres.</p>
              </div>
            ) : (
              <PlatformList
                views={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                baseCurrency={baseCurrency}
                now={clock}
              />
            )}
          </div>

          <PlatformPanel
            view={selected}
            baseCurrency={baseCurrency}
            syncing={selected ? syncingPlatformIds.has(selected.id) : false}
            onClose={() => setSelectedId(null)}
            onEdit={(v) => openEdit(v.row)}
            onSync={(v) => void syncChainWallet(v.row)}
            onMerge={(v) => openMerge(v.row)}
            onDelete={(v) => handleDelete(v.row)}
            onNewTransaction={
              onNewTransaction ? (v) => onNewTransaction(v.row) : undefined
            }
            onViewPositions={
              onViewPositions ? (v) => onViewPositions(v.row) : undefined
            }
            onViewTransactions={
              onViewTransactions ? (v) => onViewTransactions(v.row) : undefined
            }
            onImport={
              onImportForPlatform ? (v) => onImportForPlatform(v.row) : undefined
            }
          />
        </div>
      </div>

      {historyTruncatedPlatform ? (
        <p
          className="text-meta px-[var(--space-1)]"
          data-testid="history-truncated-notice"
        >
          L&apos;historique de « {historyTruncatedPlatform.name} » est limité aux 800
          dernières transactions renvoyées par l&apos;API. Pour un historique
          complet, importez un relevé CSV depuis votre exchange.
        </p>
      ) : null}

      {/* Modification optionnelle (nom, type, logo, wallet/API…) */}
      {editTarget && (
        <Modal
          title={`Modifier · ${editTarget.name}`}
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
                          placeholder={
                            editTarget?.hasWalletApiKey
                              ? "Clé déjà enregistrée — laisser vide pour la conserver"
                              : "zk_…"
                          }
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
                disabled={syncingPlatformIds.has(solanaDetail.platform.id)}
                onClick={() => void syncSolanaWallet(solanaDetail.platform)}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    syncingPlatformIds.has(solanaDetail.platform.id) &&
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
                className="input w-full border-red-200 bg-white py-1.5 dark:border-red-900/50 dark:bg-[var(--input-bg)]"
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

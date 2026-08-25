"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
// Note: ne pas lire localStorage dans useState() — mismatch SSR/hydratation
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  createTransactionSchema,
  platformSchema,
  type CreateTransactionForm,
  type PlatformForm,
} from "@/app/lib/schemas";
import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";
import { formatCurrency, cn } from "@/app/lib/utils";
import { fetchJson, reloadHoldings } from "@/app/lib/api-client";
import { usePriceAutoRefresh } from "@/app/hooks/use-price-auto-refresh";
import { useGlobalShortcuts } from "@/app/hooks/use-global-shortcuts";
import {
  useAssetDetailQuery,
  useHoldingsQuery,
  usePatrimonyStateQuery,
  usePlatformsQuery,
  usePortfolioHistoryQuery,
  useTransactionsMetaQuery,
} from "@/app/hooks/use-portfolio-queries";
import { ShortcutsHelpPanel } from "@/components/layout/shortcuts-help-panel";

import {
  EMPTY_HOLDINGS,
  TAB_STORAGE_KEY,
  TAB_TO_ACCOUNT_TYPE,
  isPositionsTab,
  type Holding,
  type MainTab,
  type TxRow,
} from "@/app/lib/types/ui";
import { asAccountType } from "@/app/lib/types/account-type";
import {
  asBaseAmount,
  asEurAmount,
  asPercentString,
  asPriceString,
  asQuantityString,
} from "@/app/lib/types/money-brands";
import { pathnameToTab, tabToPath } from "@/app/lib/types/tab-routes";
import {
  ENVELOPE_SELECT_OPTIONS,
  envelopeParamToTab,
  tabToEnvelopeParam,
} from "@/app/lib/types/nav-groups";
import {
  ONBOARDING_DISMISS_KEY,
  ONBOARDING_SHOW_EVERY_START_KEY,
  loadOnboardingDismissState,
  saveUiPref,
} from "@/app/lib/ui-preferences";

import dynamic from "next/dynamic";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MarketTicker } from "@/components/layout/market-ticker";
import { Shell } from "@/components/layout/display-provider";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { DashboardTab } from "@/components/dashboard/dashboard-tab";
import { EmptyPatrimonyCockpit } from "@/components/dashboard/empty-patrimony-cockpit";
import { Skeleton } from "@/components/ui/skeleton";
import { HoldingsSection } from "@/components/holdings/holdings-section";
import { TransactionModal } from "@/components/modals/transaction-modal";
import { PlatformModal } from "@/components/modals/platform-modal";
import { AssetPanel } from "@/components/holdings/asset-panel";
import { ImportCsvModal } from "@/components/modals/import-csv-modal";
import { QuickPlatformModal } from "@/components/modals/quick-platform-modal";
import { PropertyModal } from "@/components/modals/property-modal";
import { RealEstateTab } from "@/components/real-estate/real-estate-tab";
import { SecuritiesPage } from "@/components/securities/securities-page";
import {
  CryptosTab,
  type CryptoSubTab,
} from "@/components/crypto/cryptos-tab";
import { TradingTab } from "@/components/trading/trading-tab";
import { REAL_ESTATE_PLATFORM_TYPE } from "@/app/lib/real-estate/platform-type";
import { CommandPalette } from "@/components/layout/command-palette";
import {
  sortPlatformsByRecentUsage,
  touchRecentPlatformId,
} from "@/app/lib/platforms/recent";
import { buildPlatformPickOptions } from "@/app/lib/platforms/catalog-options";
import { ensurePlatformFromPreset } from "@/app/lib/platforms/ensure-from-catalog";
import type { PlatformPreset } from "@/app/lib/platforms/presets";
import {
  dashboardBlocksFor,
  resolveDashboardMaturity,
} from "@/app/lib/dashboard/maturity";

/** Placeholder léger pendant le chargement d’un onglet code-splité. */
function TabChunkFallback() {
  return (
    <div
      className="card h-48 animate-pulse bg-[var(--muted)]/40"
      aria-busy="true"
      data-testid="tab-chunk-loading"
    />
  );
}

// Onglets lourds : chunks séparés (dashboard + positions restent eager — chemins chauds).
const TransactionsTab = dynamic(
  () =>
    import("@/components/transactions/transactions-tab").then((m) => ({
      default: m.TransactionsTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const PlatformsTab = dynamic(
  () =>
    import("@/components/platforms/platforms-tab").then((m) => ({
      default: m.PlatformsTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const BanksTab = dynamic(
  () =>
    import("@/components/tabs/banks-tab").then((m) => ({
      default: m.BanksTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const AssuranceVieTab = dynamic(
  () =>
    import("@/components/life-insurance/assurance-vie-page").then((m) => ({
      default: m.AssuranceVieTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const LiabilitiesTab = dynamic(
  () =>
    import("@/components/tabs/liabilities-tab").then((m) => ({
      default: m.LiabilitiesTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const EmployeeSavingsTab = dynamic(
  () =>
    import("@/components/employee-savings/employee-savings-page").then((m) => ({
      default: m.EmployeeSavingsTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const AlternativesTab = dynamic(
  () =>
    import("@/components/tabs/alternatives-tab").then((m) => ({
      default: m.AlternativesTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const FiscalTab = dynamic(
  () =>
    import("@/components/fiscal/fiscal-tab").then((m) => ({
      default: m.FiscalTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);

const emptySubscribe = () => () => undefined;

/** true uniquement après hydratation client (snapshot serveur = false). */
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

/**
 * Point d'entrée : pas de SSR HTML « riche » pour ce shell (évite hydration mismatch
 * Holdings / onboarding / prefs). Serveur + 1er paint client = skeleton identique.
 */
export function PortfolioApp(props: { initialTab?: MainTab }) {
  const isClient = useIsClient();
  if (!isClient) {
    return <PortfolioAppSkeleton />;
  }
  return <PortfolioAppClient {...props} />;
}

function PortfolioAppSkeleton() {
  return (
    <div
      className="min-h-screen text-[var(--foreground)]"
      suppressHydrationWarning
      data-testid="portfolio-skeleton"
      aria-busy="true"
    >
      <div className="border-b border-[var(--border)] bg-[var(--header-bg)] px-3 py-4 sm:px-5">
        <div className="app-shell h-10 skeleton-block rounded-lg" />
      </div>
      <div className="app-shell space-y-6 px-3 py-6 sm:px-5 lg:px-6">
        <div className="grid w-full min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-20 skeleton-block rounded-xl border border-[var(--border)]"
            />
          ))}
        </div>
        <div className="card h-48 skeleton-block" />
        <div className="card h-72 skeleton-block" />
      </div>
    </div>
  );
}

/**
 * Shell portefeuille — navigation pilotée par l'URL (App Router).
 * Rendu uniquement côté client (après mount).
 */
function PortfolioAppClient({
  initialTab = "dashboard",
}: {
  initialTab?: MainTab;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  // URL = source de vérité (layout stable → pas de remount à chaque tab)
  // Priorité : ?envelope=  puis segment /positions/pea
  const envelopeFromQuery = searchParams.get("envelope");
  const tabFromPath = pathnameToTab(pathname) || initialTab;
  const tab: MainTab =
    isPositionsTab(tabFromPath) && envelopeFromQuery != null
      ? envelopeParamToTab(envelopeFromQuery)
      : tabFromPath;

  const [baseCurrency, setBaseCurrency] = useState("EUR");
  const [showTx, setShowTx] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [showPlatform, setShowPlatform] = useState(false);
  const [showQuickPlatform, setShowQuickPlatform] = useState(false);
  const [quickPlatformPrefill, setQuickPlatformPrefill] = useState("");
  /** Cible de la création contextuelle. */
  const [quickPlatformTarget, setQuickPlatformTarget] = useState<
    "tx" | "import" | "standalone"
  >("tx");
  /** Plateforme par défaut pour l’import (après création à la volée). */
  const [importDefaultPlatform, setImportDefaultPlatform] = useState<{
    id: string;
    name: string;
  } | null>(null);
  /** IDs créés dans la session (badge « Nouvelle » dans le combobox). */
  const [newPlatformIds, setNewPlatformIds] = useState<Set<string>>(
    () => new Set()
  );
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const [cryptoSub, setCryptoSub] = useState<CryptoSubTab>("DASHBOARD");
  const [assetLabel, setAssetLabel] = useState("");
  const [platformComboLabel, setPlatformComboLabel] = useState("");
  const [txPlatformLabel, setTxPlatformLabel] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  /** Préférence onboarding — seed client (SSR: true) */
  const [showEveryStart, setShowEveryStart] = useState(() =>
    typeof window !== "undefined"
      ? loadOnboardingDismissState().showEveryStart
      : true
  );
  const baseCurrencyRef = useRef(baseCurrency);
  /** Auto-refresh cours : positions + dashboard uniquement (pas fiscal / passifs / etc.). */
  const priceRefreshEnabled =
    tab === "dashboard" || isPositionsTab(tab) || tab === "transactions";
  const { refreshMutation, lastPriceSync, priceSyncPulse } =
    usePriceAutoRefresh(baseCurrencyRef, { enabled: priceRefreshEnabled });

  // Ref devise pour le timer prix — pas pendant le render (React 19)
  useEffect(() => {
    baseCurrencyRef.current = baseCurrency;
  }, [baseCurrency]);

  // Deep-link / e2e : ?import=1 → état d’import dérivé + manuel
  const importFromUrl = searchParams.get("import") === "1";
  const [showImportManual, setShowImportManual] = useState(false);
  /*
    Les préférences vivaient aussi dans une modale, ouverte par le raccourci
    Paramètres du rail. Ce raccourci a disparu — le menu Compte y menait déjà —
    et la modale n'était plus atteignable : elle rendait le même
    `PreferencesPanel`, en moins complet, sans la devise de référence.
  */
  const showImport = importFromUrl || showImportManual;
  const setShowImport = (v: boolean) => {
    setShowImportManual(v);
    if (!v && importFromUrl) {
      // Retirer le query param sans remount
      const params = new URLSearchParams(searchParams.toString());
      params.delete("import");
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }
  };

  // Persiste l'onglet pour un éventuel retour hors-URL (préférence)
  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  const setTab = useCallback(
    (next: MainTab) => {
      let path = tabToPath(next);
      // Positions : URL canonique /positions?envelope=… — uniquement pour les
      // enveloppes réellement sélectionnables depuis ce filtre. `crypto` et
      // `immobilier` restent des `isPositionsTab` (leur sous-vue "Comptant" /
      // "Parc" affiche encore le tableau filtré) mais ont leur propre onglet
      // de premier niveau : les faire passer par `/positions?envelope=` les
      // ramènerait sur la page générique au lieu de leur URL dédiée.
      const isEnvelopeSelectorTab = ENVELOPE_SELECT_OPTIONS.some(
        (o) => o.tab === next
      );
      if (isEnvelopeSelectorTab) {
        const param = tabToEnvelopeParam(next);
        path = param ? `/positions?envelope=${param}` : "/positions";
      }
      const current =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : pathname;
      if (path !== current) {
        router.push(path, { scroll: false });
      }
      try {
        localStorage.setItem(TAB_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    },
    [router, pathname]
  );

  /** Multi-enveloppes : null = dériver de l’URL (tab) ; sinon sélection manuelle */
  const ALL_ENVELOPE_TYPES = useMemo(
    () => Object.keys(ACCOUNT_TYPES) as AccountType[],
    []
  );
  const [manualEnvelopeFilters, setManualEnvelopeFilters] = useState<
    AccountType[] | null
  >(null);
  /**
   * Quand le multi-select enveloppe pousse l’URL vers /positions (holdings),
   * le changement de `tab` ne doit PAS réinitialiser la sélection manuelle
   * (sinon cocher une 2ᵉ case → reset → toutes les cases cochées).
   */
  const skipEnvelopeResetRef = useRef(false);

  // Reset sélection manuelle quand l’URL / tab positions change (nav latérale)
  useEffect(() => {
    if (skipEnvelopeResetRef.current) {
      skipEnvelopeResetRef.current = false;
      return;
    }
    setManualEnvelopeFilters(null);
  }, [tab]);

  const envelopeFilters: AccountType[] = useMemo(() => {
    if (manualEnvelopeFilters != null) return manualEnvelopeFilters;
    const fromTab = TAB_TO_ACCOUNT_TYPE[tab];
    if (fromTab) return [fromTab];
    /**
     * `/positions?envelope=crypto` — isoler dans la vue transverse une
     * enveloppe qui a son propre onglet de premier niveau (crypto,
     * immobilier) et n'apparaît donc pas dans `ENVELOPE_SELECT_OPTIONS`.
     *
     * Piloté par l'URL et non par un état local posé avant navigation : le
     * filtre survit au rafraîchissement, se partage, et ne dépend pas de
     * l'ordre dans lequel le changement d'onglet et le `setState`
     * s'appliquent.
     */
    const q = (envelopeFromQuery || "").trim().toUpperCase();
    if (q && q in ACCOUNT_TYPES) return [q as AccountType];
    return [...ALL_ENVELOPE_TYPES];
  }, [manualEnvelopeFilters, tab, ALL_ENVELOPE_TYPES, envelopeFromQuery]);

  const onEnvelopeFiltersChange = useCallback(
    (next: AccountType[]) => {
      setManualEnvelopeFilters(next);
      // URL : 0 → holdings ; 1 → tab dédié ; multi → holdings (filtre local)
      if (next.length === 1) {
        const opt = ENVELOPE_SELECT_OPTIONS.find((o) => o.value === next[0]);
        if (opt) {
          // Laisser l’URL (tab) redevenir source de vérité pour 1 enveloppe
          skipEnvelopeResetRef.current = false;
          setTab(opt.tab);
          return;
        }
        /**
         * Enveloppe sans entrée dans le sélecteur — CTO, PEA, crypto et
         * immobilier, qui ont tous leur onglet de premier niveau.
         *
         * On reste sur Positions, mais l'URL doit continuer à porter le filtre :
         * sans elle, isoler le PEA dans la vue transverse ne survivrait ni au
         * rafraîchissement ni au partage, alors que c'est précisément la
         * propriété que ce filtre garantit ailleurs. `/positions?envelope=…`
         * est le mécanisme déjà prévu pour ce cas et relu plus haut.
         */
        skipEnvelopeResetRef.current = true;
        const param = next[0]!.toLowerCase();
        const path = `/positions?envelope=${param}`;
        const current =
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "";
        if (path !== current) router.push(path, { scroll: false });
        return;
      }
      if (next.length === 0 || next.length > 1) {
        skipEnvelopeResetRef.current = true;
        setTab("holdings");
      }
    },
    [setTab, router]
  );

  // ─── Data ───────────────────────────────────────────────────────────────────

  const holdingsQ = useHoldingsQuery(baseCurrency);
  const historyQ = usePortfolioHistoryQuery(baseCurrency);
  const platformsQ = usePlatformsQuery(baseCurrency);
  /*
    Compte vierge ou compte actif ?

    C'est cette réponse — et non une préférence d'affichage — qui décide entre
    le cockpit d'accueil et le tableau de bord. Elle porte sur les données
    réelles de toutes les familles patrimoniales, pas sur les seules positions :
    une dette, un compte bancaire ou un contrat d'assurance-vie suffisent à
    rendre un compte actif, même sans la moindre position calculée.
  */
  const patrimonyQ = usePatrimonyStateQuery();
  const detailQ = useAssetDetailQuery(detailAssetId);
  /** Compte total léger (maturité dashboard) — pas le journal paginé. */
  const txMetaQ = useTransactionsMetaQuery();

  // ─── Forms ──────────────────────────────────────────────────────────────────

  const txForm = useForm<CreateTransactionForm>({
    resolver: zodResolver(createTransactionSchema) as never,
    defaultValues: {
      type: "ACHAT",
      platformId: "",
      assetId: "",
      ticker: "",
      quantity: "",
      unitPrice: "",
      cashAmount: "",
      fees: "0",
      currency: "EUR",
      fxRateToEur: "1",
      withholdingTaxRate: "",
      exDate: "",
      paymentDate: "",
      occurredAt: new Date().toISOString().slice(0, 16),
      notes: "",
    },
  });

  const platformForm = useForm<PlatformForm>({
    resolver: zodResolver(platformSchema) as never,
    defaultValues: {
      name: "",
      // Empty until user picks a type in the modal (step 1 of the form flow)
      type: "" as PlatformForm["type"],
      subtype: null,
      logoKey: "",
      logoUrl: "",
      walletAddress: "",
      walletApiKey: "",
    },
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const patchAccountType = useMutation({
    mutationFn: (body: { assetId: string; accountType: string }) =>
      fetchJson(`/api/assets/${body.assetId}/account-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountType: body.accountType }),
      }),
    onSuccess: async () => {
      await reloadHoldings(qc, baseCurrency);
      toast.success("Type de compte mis à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Épingle / retire un actif de la watchlist du tableau de bord.
   *
   * L'état voulu part au serveur plutôt qu'une bascule : deux onglets ouverts
   * sur la même fiche convergent alors vers le même résultat.
   */
  const patchWatchlist = useMutation({
    mutationFn: (body: { assetId: string; watchlisted: boolean }) =>
      fetchJson(`/api/assets/${body.assetId}/watchlist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlisted: body.watchlisted }),
      }),
    onSuccess: async (_data, vars) => {
      await reloadHoldings(qc, baseCurrency);
      toast.success(
        vars.watchlisted
          ? "Ajouté à la watchlist"
          : "Retiré de la watchlist"
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onCategoryChange = useCallback(
    async (_assetId: string, _category: string) => {
      await reloadHoldings(qc, baseCurrencyRef.current);
      toast.success("Catégorie mise à jour");
    },
    [qc]
  );

  const saveTx = useMutation({
    mutationFn: async (body: CreateTransactionForm & { id?: string }) => {
      if (
        (body.type === "ACHAT" || body.type === "VENTE") &&
        (!body.assetId || body.assetId === "")
      ) {
        return Promise.reject(
          new Error("Sélectionnez un actif dans la liste (cliquez une suggestion)")
        );
      }
      // Persist ticker correction on the asset (autocomplete default may be wrong)
      const ticker = (body.ticker ?? "").trim();
      if (body.assetId && ticker) {
        try {
          await fetchJson(`/api/assets/${body.assetId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker }),
          });
        } catch (e) {
          // Non-blocking if patch fails? Better fail so user knows
          throw e instanceof Error
            ? e
            : new Error("Impossible de mettre à jour le ticker");
        }
      } else if (body.assetId && body.ticker === "") {
        // Explicit clear of ticker
        try {
          await fetchJson(`/api/assets/${body.assetId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker: null }),
          });
        } catch {
          /* ignore empty clear failures */
        }
      }
      const { ticker: _t, ...txBody } = body;
      return fetchJson<{ transaction: { assetId: string | null } }>("/api/transactions", {
        method: body.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(txBody),
      });
    },
    onSuccess: async (res) => {
      const wasEdit = Boolean(editingTxId);
      const pid = txForm.getValues("platformId");
      if (pid) touchRecentPlatformId(pid);
      setShowTx(false);
      setEditingTxId(null);
      setAssetLabel("");
      txForm.reset();
      await qc.invalidateQueries({ queryKey: ["transactions"] });
      await qc.invalidateQueries({ queryKey: ["assets"] });
      await qc.invalidateQueries({ queryKey: ["platforms"] });
      await qc.invalidateQueries({ queryKey: ["asset-detail"] });
      void qc.invalidateQueries({ queryKey: ["portfolio-history"] });
      const fresh = await reloadHoldings(qc, baseCurrency);
      const aid = res?.transaction?.assetId;
      const row = aid ? fresh.holdings.find((h: Holding) => h.assetId === aid) : null;
      if (row) {
        toast.success(
          `${wasEdit ? "Modifié" : "Ajouté"} · ${row.name} · qté ${Number(row.quantity).toLocaleString("fr-FR")} · CUMP ${formatCurrency(row.avgCostEur, "EUR")} · valeur ${formatCurrency(row.marketValueBase || row.marketValueEur, baseCurrency)}`
        );
      } else {
        toast.success(
          wasEdit
            ? "Transaction mise à jour — positions recalculées"
            : "Transaction enregistrée — positions recalculées"
        );
      }
      setTab("holdings");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTx = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/transactions?id=${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Transaction supprimée — positions recalculées");
      await qc.invalidateQueries({ queryKey: ["transactions"] });
      await qc.invalidateQueries({ queryKey: ["asset-detail"] });
      void qc.invalidateQueries({ queryKey: ["portfolio-history"] });
      await reloadHoldings(qc, baseCurrency);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePlatform = useMutation({
    mutationFn: async (body: PlatformForm) => {
      const res = await fetchJson<{
        platform: {
          id: string;
          name: string;
          logoKey?: string | null;
          walletAddress?: string | null;
        };
        created?: boolean;
      }>("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { body, res };
    },
    onSuccess: async ({ body, res }) => {
      toast.success("Plateforme créée");
      setShowPlatform(false);
      setPlatformComboLabel("");
      platformForm.reset();
      void qc.invalidateQueries({ queryKey: ["platforms"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });

      // Auto-sync Zerion / Solana si adresse wallet fournie
      const address = (body.walletAddress || "").trim();
      if (!address || body.type !== "BLOCKCHAIN") return;

      const { resolveChainSyncForPlatform } =
        await import("@/app/lib/market/chain-wallet-sync");
      const cap = resolveChainSyncForPlatform({
        logoKey: body.logoKey || res.platform.logoKey,
        name: body.name || res.platform.name,
        type: "BLOCKCHAIN",
      });
      if (!cap?.syncPath) return;

      try {
        if (cap.provider === "zerion") {
          const sync = await fetchJson<{
            summary?: {
              balances?: number;
              transactions?: number;
              assetsTouched?: number;
              historyTxs?: number;
            };
            ledgerError?: string | null;
          }>(cap.syncPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platformId: res.platform.id,
              address,
              // Vide → ZERION_API_KEY serveur (jamais de clé hardcodée côté client)
              apiKey: body.walletApiKey || undefined,
              chainPreset: body.logoKey || cap.presetKey,
              allChains: false,
              writeLedger: true,
            }),
          });
          const s = sync.summary;
          if (sync.ledgerError) {
            toast.message(`Zerion : ${sync.ledgerError}`);
          } else if (
            (s?.assetsTouched ?? 0) === 0 &&
            (s?.balances ?? 0) === 0 &&
            (s?.historyTxs ?? 0) === 0
          ) {
            toast.message(
              "Zerion · aucun solde / tx pour cette adresse (vérifiez l’adresse ou la clé API)"
            );
          } else {
            toast.success(
              `Zerion · ${s?.assetsTouched ?? 0} pos. · ${s?.balances ?? 0} soldes · ${s?.historyTxs ?? 0} tx`
            );
          }
          await qc.invalidateQueries({ queryKey: ["platforms"] });
          await qc.invalidateQueries({ queryKey: ["holdings"] });
          await qc.invalidateQueries({ queryKey: ["transactions"] });
        } else if (cap.provider === "helius-solana") {
          const sync = await fetchJson<{
            ledger?: { assetsTouched?: number; txsCreated?: number } | null;
            ledgerError?: string | null;
            txSync?: { newTransactions?: number } | null;
          }>(cap.syncPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platformId: res.platform.id,
              address,
              writeLedger: true,
              syncTransactions: true,
            }),
          });
          if (sync.ledgerError) {
            toast.message(`Solana · snapshot OK — ${sync.ledgerError}`);
          } else {
            toast.success(
              `Solana · ${sync.ledger?.assetsTouched ?? 0} pos. · ${sync.txSync?.newTransactions ?? 0} tx`
            );
          }
          await qc.invalidateQueries({ queryKey: ["platforms"] });
          await qc.invalidateQueries({ queryKey: ["holdings"] });
          await qc.invalidateQueries({ queryKey: ["transactions"] });
        }
      } catch (e) {
        toast.message(
          e instanceof Error
            ? `Plateforme créée — sync : ${e.message}`
            : "Plateforme créée — sync wallet échouée"
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePlatform = useMutation({
    mutationFn: ({
      id,
      force,
    }: {
      id: string;
      force?: boolean;
    }) => {
      const q = new URLSearchParams({ id });
      if (force) q.set("force", "1");
      return fetchJson<{
        ok: boolean;
        deleted?: { assets?: number; transactions?: number; name?: string };
      }>(`/api/platforms?${q.toString()}`, {
        method: "DELETE",
      });
    },
    onSuccess: (res) => {
      const d = res.deleted;
      toast.success(
        d
          ? `Plateforme supprimée · ${d.transactions ?? 0} tx · ${d.assets ?? 0} actif(s)`
          : "Plateforme supprimée"
      );
      void qc.invalidateQueries({ queryKey: ["platforms"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["portfolio-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Derived ────────────────────────────────────────────────────────────────

  const allHoldings = holdingsQ.data?.holdings ?? EMPTY_HOLDINGS;

  const holdings = useMemo(() => {
    if (envelopeFilters.length === 0) return [];
    if (envelopeFilters.length === ALL_ENVELOPE_TYPES.length) return allHoldings;
    const set = new Set(envelopeFilters);
    return allHoldings.filter((h) =>
      set.has((h.accountType || "CTO") as AccountType)
    );
  }, [allHoldings, envelopeFilters, ALL_ENVELOPE_TYPES.length]);

  /** Tickers actions/ETF pour le calendrier résultats (exclut CRYPTO) */
  const portfolioTickers = useMemo(() => {
    const seen = new Set<string>();
    const out: { ticker: string; name: string }[] = [];
    for (const h of allHoldings) {
      if ((h.assetClass || "").toUpperCase() === "CRYPTO") continue;
      const t = (h.ticker ?? "").trim();
      if (!t) continue;
      const key = t.toUpperCase().replace(/\..*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ticker: t, name: h.name });
    }
    return out;
  }, [allHoldings]);

  const platforms = useMemo(
    () => platformsQ.data?.platforms ?? holdingsQ.data?.platforms ?? [],
    [platformsQ.data?.platforms, holdingsQ.data?.platforms]
  );
  const summary = holdingsQ.data?.summary;
  const txCount =
    txMetaQ.data?.totalAll ?? txMetaQ.data?.total ?? 0;

  /**
   * Positions crypto comptant — hors DeFi et NFT, qui ont leurs propres vues.
   * Alimente les cartes par coin : la consolidation se recalcule à chaque
   * lecture depuis le journal, jamais depuis un instantané stocké.
   */
  const cryptoSpotHoldings = useMemo(
    () =>
      allHoldings.filter(
        (h) =>
          (h.accountType || "") === "CRYPTO" &&
          !h.isDefiPosition &&
          !h.isNftItem
      ),
    [allHoldings]
  );

  // L'onglet Cryptos rend désormais ses quatre vues lui-même (dont le
  // comptant, en cartes par coin). Le tableau Positions y ferait doublon —
  // il reste la lecture comptable transverse, accessible depuis son onglet.
  const positionsView = isPositionsTab(tab) && tab !== "crypto";
  const isDashboard = tab === "dashboard";

  /*
    Le compte est-il vierge, ici et maintenant ?

    La réponse du serveur fait foi, mais elle peut dater de quelques instants :
    créer une plateforme ou une transaction rend le compte actif avant que la
    requête n'ait été rejouée. Toute donnée déjà connue du client force donc le
    tableau de bord.

    Le raccourci ne joue que dans ce sens. Il ne peut jamais déclarer un compte
    vierge — c'est précisément l'erreur que le chantier corrige : une absence
    de positions n'est pas une absence de patrimoine, un compte peut ne porter
    qu'une dette ou qu'un contrat d'assurance-vie.
  */
  const hasLocalPatrimonyEvidence =
    platforms.length > 0 || txCount > 0 || allHoldings.length > 0;
  const patrimonyIsEmptyNow =
    patrimonyQ.data?.isEmpty === true && !hasLocalPatrimonyEvidence;
  const patrimonyResolved = Boolean(patrimonyQ.data) || hasLocalPatrimonyEvidence;

  /** Maturité du compte → densité du dashboard + KPI strip */
  const dashboardMaturity = resolveDashboardMaturity({
    platformCount: platforms.length,
    transactionCount: txCount,
    holdingCount: allHoldings.length,
    historyPointCount: historyQ.data?.history?.length ?? 0,
  });
  const dashBlocks = dashboardBlocksFor(dashboardMaturity);
  /**
   * Bandeau d'indicateurs générique — partout sauf là où l'écran porte déjà
   * les siens : le dashboard (hero + TerminalKpiRow), le portefeuille (les
   * cinq cartes de `PortfolioKpiCards`), PEA & CTO et l'assurance-vie (leur
   * propre rangée). Les empiler donnerait deux fois la même valeur totale à
   * quinze pixels d'écart, et le lecteur chercherait la différence entre les
   * deux plutôt que de lire la page.
   */
  const showGlobalKpis =
    !isDashboard &&
    !positionsView &&
    tab !== "securities" &&
    tab !== "assurance-vie" &&
    tab !== "epargne-salariale";

  /**
   * Plateformes « Notaire / immobilier » : la saisie d'un bien y suit un
   * formulaire dédié plutôt que le modal de transaction.
   */
  const realEstatePlatformIds = useMemo(
    () =>
      platforms
        .filter((p) => p.type === REAL_ESTATE_PLATFORM_TYPE)
        .map((p) => p.id),
    [platforms]
  );
  const [propertyPlatformId, setPropertyPlatformId] = useState<string | null>(
    null
  );
  const propertyPlatformName =
    platforms.find((p) => p.id === propertyPlatformId)?.name ?? "";

  const platformSelectOptions = useMemo(() => {
    // Comptes user (usage récent) + catalogue courtiers avec logos
    const ownedSorted = sortPlatformsByRecentUsage(
      platforms.map((p) => ({
        value: p.id,
        label: p.name,
        subtitle: "",
        logoUrl: p.logoUrl,
      }))
    );
    const order = new Map(ownedSorted.map((o, i) => [o.value, i]));
    const platformsOrdered = [...platforms].sort((a, b) => {
      const ra = order.has(a.id) ? order.get(a.id)! : 9999;
      const rb = order.has(b.id) ? order.get(b.id)! : 9999;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
    return buildPlatformPickOptions({
      platforms: platformsOrdered,
      newPlatformIds,
      includeCatalog: true,
    });
  }, [platforms, newPlatformIds]);

  const handleCatalogPlatformPick = useCallback(
    async (
      target: "tx" | "import",
      opt: { label: string; preset?: PlatformPreset; value: string }
    ) => {
      try {
        const key =
          opt.preset?.key ||
          (opt.value.startsWith("catalog:")
            ? opt.value.slice("catalog:".length)
            : "");
        const ensured = await ensurePlatformFromPreset(
          opt.preset || key || opt.label
        );
        if (ensured.created) {
          setNewPlatformIds((prev) => new Set(prev).add(ensured.id));
        }
        touchRecentPlatformId(ensured.id);
        void qc.invalidateQueries({ queryKey: ["platforms"] });
        void qc.invalidateQueries({ queryKey: ["holdings"] });
        if (target === "tx") {
          txForm.setValue("platformId", ensured.id, { shouldValidate: true });
          setTxPlatformLabel(ensured.name);
        } else {
          setImportDefaultPlatform({ id: ensured.id, name: ensured.name });
        }
        toast.success(
          ensured.created
            ? `Plateforme « ${ensured.name} » ajoutée avec logo`
            : `Plateforme « ${ensured.name} » sélectionnée`
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Impossible d’ajouter ce courtier"
        );
      }
    },
    [qc, txForm]
  );

  const onTriggerLevelChange = useCallback(
    async (
      assetId: string,
      field: "stopLoss" | "tp1" | "tp2" | "tp3" | "tp4",
      value: string | null
    ) => {
      try {
        await fetchJson(`/api/assets/${assetId}/triggers`, {
          method: "PATCH",
          body: JSON.stringify({ [field]: value }),
        });
        await reloadHoldings(qc, baseCurrencyRef.current);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec mise à jour SL/TP");
      }
    },
    [qc]
  );

  const onAccountTypeChange = useCallback(
    (assetId: string, accountType: string) => {
      patchAccountType.mutate({ assetId, accountType });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function openEditTx(t: TxRow) {
    setEditingTxId(t.id);
    const qty = t.quantity != null ? String(t.quantity) : "";
    const price = t.unitPrice != null ? String(t.unitPrice) : "";
    const cash =
      !qty && t.grossAmountEur
        ? String(Number(t.grossAmountEur) / Number(t.fxRateToEur || 1))
        : "";
    const ticker =
      (t.asset as { ticker?: string | null } | null | undefined)?.ticker || "";
    const tExt = t as {
      withholdingTaxRate?: string | null;
      exDate?: string | null;
      paymentDate?: string | null;
    };
    txForm.reset({
      type: t.type as CreateTransactionForm["type"],
      platformId: t.platformId,
      assetId: t.assetId || "",
      ticker,
      quantity: qty,
      unitPrice: price,
      cashAmount: cash,
      fees: String(t.fees ?? "0"),
      currency: t.currency || "EUR",
      fxRateToEur: String(t.fxRateToEur ?? "1"),
      withholdingTaxRate: tExt.withholdingTaxRate
        ? String(tExt.withholdingTaxRate)
        : "",
      exDate: tExt.exDate ? tExt.exDate.slice(0, 10) : "",
      paymentDate: tExt.paymentDate ? tExt.paymentDate.slice(0, 10) : "",
      occurredAt: new Date(t.occurredAt).toISOString().slice(0, 16),
      notes: t.notes || "",
    });
    setAssetLabel(
      t.asset?.name
        ? `${t.asset.name}${ticker ? ` (${ticker})` : ""}`
        : ""
    );
    setTxPlatformLabel(t.platform?.name || "");
    void qc.invalidateQueries({ queryKey: ["platforms"] });
    void qc.invalidateQueries({ queryKey: ["assets"] });
    setShowTx(true);
  }

  function changeBase(code: string) {
    if (code === baseCurrency) return;
    setBaseCurrency(code);
    void fetch("/api/portfolio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseCurrency: code }),
    }).catch(() => undefined);
  }

  function openNewTransaction(
    type?: string,
    prefill?: Holding,
    /** Pré-sélection plateforme (ex. menu Mes plateformes) — prioritaire sur prefill holding. */
    platformOverride?: { id: string; name: string }
  ) {
    setEditingTxId(null);
    void qc.invalidateQueries({ queryKey: ["platforms"] });
    void qc.invalidateQueries({ queryKey: ["assets"] });
    const txType = (type || "ACHAT") as CreateTransactionForm["type"];
    const platformId =
      platformOverride?.id || prefill?.platformId || platforms[0]?.id || "";
    const platformName =
      platformOverride?.name ||
      platforms.find((p) => p.id === platformId)?.name ||
      prefill?.platformName ||
      "";
    txForm.reset({
      type: txType,
      platformId,
      assetId: prefill?.assetId || "",
      ticker: prefill?.ticker || "",
      quantity: "",
      unitPrice: "",
      cashAmount: "",
      fees: "0",
      currency: prefill?.currency || "EUR",
      fxRateToEur: "1",
      withholdingTaxRate: "",
      exDate: "",
      paymentDate: "",
      occurredAt: new Date().toISOString().slice(0, 16),
      notes: "",
    });
    setAssetLabel(
      prefill
        ? `${prefill.name}${prefill.ticker ? ` (${prefill.ticker})` : ""}`
        : ""
    );
    setTxPlatformLabel(platformName);
    setShowTx(true);
  }

  function openAddPlatform() {
    setShowPlatform(true);
  }

  /** Plateforme sur laquelle ouvrir le journal depuis le module Plateformes. */
  const [txPlatformFilter, setTxPlatformFilter] = useState("");
  function viewTransactionsForPlatform(platform: { id: string }) {
    setTxPlatformFilter(platform.id);
    setTab("transactions");
  }

  function viewPositionsForPlatform(platform: { id: string; name: string }) {
    const qs = new URLSearchParams({
      platformId: platform.id,
      platformName: platform.name,
    });
    router.push(`/positions?${qs.toString()}`, { scroll: false });
    try {
      localStorage.setItem(TAB_STORAGE_KEY, "holdings");
    } catch {
      /* ignore */
    }
  }

  // ─── Raccourcis clavier globaux (/, n, ?, Échap, Ctrl+K) ───────────────────
  useGlobalShortcuts({
    onSearch: () => setCmdOpen(true),
    onNewTransaction: () => openNewTransaction("ACHAT"),
    onHelp: () => setShortcutsHelpOpen(true),
    onEscape: () => {
      if (shortcutsHelpOpen) {
        setShortcutsHelpOpen(false);
        return;
      }
      if (cmdOpen) setCmdOpen(false);
    },
  });

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen min-w-0 max-w-[100vw] overflow-x-clip text-[var(--foreground)]">
      {/* Skip link a11y — premier Tab */}
      <a
        href="#main-content"
        className={cn(
          "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100]",
          "focus:rounded-[var(--radius-md)] focus:bg-[var(--primary)] focus:px-3 focus:py-2",
          "focus:text-sm focus:font-medium focus:text-[var(--primary-foreground)]"
        )}
      >
        Aller au contenu principal
      </a>

      {/* Bandeau marchés — la ligne la plus haute et la plus fine du terminal */}
      <MarketTicker />

      <AppHeader
        baseCurrency={baseCurrency}
        onBaseCurrencyChange={changeBase}
        lastPriceSync={lastPriceSync}
        priceSyncPulse={priceSyncPulse}
        refreshPending={refreshMutation.isPending}
        onRefreshPrices={() => refreshMutation.mutate({ silent: false })}
        onOpenTransaction={(type) => openNewTransaction(type)}
        onOpenImport={() => setShowImport(true)}
        onOpenCommandPalette={() => setCmdOpen(true)}
      />

      {/*
        Coquille : colonne de navigation figée + zone de travail défilante.
        La sidebar remplace la rangée d'onglets — c'est ce qui libère le centre
        du header pour la recherche.
      */}
      <div className="term-shell">
        <AppSidebar
          tab={tab}
          onTabChange={setTab}
        />

        <Shell>
        {/*
          module-flow : rythme vertical KPI → corps du module (tous onglets).
          Avant : main-content plat → Positions/Transactions collés aux indicateurs.
        */}
        <div
          id="main-content"
          tabIndex={-1}
          className="module-flow outline-none"
        >
          {/*
            KPI strip :
            - onglets métier : toujours
            - dashboard empty/setup : masqué (réduit la densité perçue)
            - dashboard active : cockpit complet
          */}
          {showGlobalKpis && (
            <div className="module-kpi-band min-w-0" data-slot="kpi-band">
              {/*
                Plus de `BrandBannerSurface` : la bannière dorée était le
                dernier vestige décoratif du fond de marque, et sur un bandeau
                d'indicateurs elle bruitait directement la lecture des
                chiffres. Les tuiles portent leur propre surface.
              */}
              <div className="min-w-0">
                <KpiStrip
                  summary={summary}
                  baseCurrency={baseCurrency}
                  history={historyQ.data?.history}
                  smartFilter={isDashboard && dashBlocks.kpiSmartFilter}
                  /*
                    Même garde que les modules refondus : `isPending && !data`.
                    `useHoldingsQuery` conserve les données précédentes
                    (`keepPreviousData`), donc un changement de devise ne
                    repasse pas le bandeau en chargement — seul le tout premier
                    chargement, sans cache, l'active.
                  */
                  loading={holdingsQ.isPending && !holdingsQ.data}
                />
              </div>
            </div>
          )}

          <div className="module-main" data-slot="module-main">
            {/*
              Onglet Immobilier : le tableau Positions montre déjà la valeur de
              chaque bien, mais pas la dette rattachée, le net qui en découle ni
              les rendements. Ces chiffres n'ont de sens que rapprochés, d'où ce
              panneau au-dessus du tableau.
            */}
            {tab === "immobilier" && (
              <RealEstateTab
                holdings={allHoldings}
                /*
                  La valeur des biens vient des positions, pas de la fiche :
                  sans cette garde, la bande d'indicateurs affichait 0 € le
                  temps que le portefeuille arrive. Même formule qu'au-dessus,
                  et même raison — une donnée qui n'est pas encore là ne vaut
                  pas zéro.
                */
                holdingsLoading={holdingsQ.isPending && !holdingsQ.data}
                className="mb-3"
              />
            )}

            {tab === "securities" && <SecuritiesPage className="mb-3" />}

            {tab === "crypto" && (
              <CryptosTab
                sub={cryptoSub}
                onSubChange={setCryptoSub}
                holdings={cryptoSpotHoldings}
                baseCurrency={baseCurrency}
                onOpenPositions={() => {
                  // Vers la lecture comptable : Positions filtré sur
                  // l'enveloppe crypto, via l'URL (refresh-safe, partageable).
                  skipEnvelopeResetRef.current = true;
                  setManualEnvelopeFilters(null);
                  router.push("/positions?envelope=crypto", { scroll: false });
                }}
                className="mb-3"
              />
            )}

            {tab === "trading" && <TradingTab baseCurrency={baseCurrency} />}

            <div data-slot="positions">
              {positionsView ? (
                /*
                  Liste et détail côte à côte : la colonne de droite est un
                  élément de la grille, pas une surimpression. Sélectionner une
                  ligne ne masque donc jamais le portefeuille — c'était tout le
                  défaut du panneau modal qu'elle remplace.
                */
                <div className="grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_var(--panel-width)] xl:items-start">
                  <HoldingsSection
                    tab={tab}
                    holdings={holdings}
                    history={historyQ.data?.history}
                    loading={holdingsQ.isPending && !holdingsQ.data}
                    baseCurrency={baseCurrency}
                    envelopeFilters={envelopeFilters}
                    onEnvelopeFiltersChange={onEnvelopeFiltersChange}
                    onAccountTypeChange={onAccountTypeChange}
                    onTriggerLevelChange={onTriggerLevelChange}
                    onRowDoubleClick={setDetailAssetId}
                    selectedAssetId={detailAssetId}
                    onCategoryChange={onCategoryChange}
                    onAddTransaction={() => openNewTransaction("ACHAT")}
                    onImport={() => setShowImport(true)}
                  />

                  <AssetPanel
                    loading={detailQ.isPending && Boolean(detailAssetId)}
                    data={detailAssetId ? detailQ.data : null}
                    baseCurrency={baseCurrency}
                    /*
                      Le poids ne peut pas se calculer dans le panneau : il ne
                      connaît qu'un actif, pas le total. Il vient d'ici, où les
                      positions sont déjà chargées — et reste `null` si la ligne
                      est introuvable, plutôt que d'afficher 0 %.
                    */
                    portfolioSharePct={(() => {
                      const h = allHoldings.find(
                        (x) => x.assetId === detailAssetId
                      );
                      const pct =
                        h?.allocationPct != null ? Number(h.allocationPct) : NaN;
                      return Number.isFinite(pct) ? pct : null;
                    })()}
                    watchlisted={Boolean(
                      allHoldings.find((x) => x.assetId === detailAssetId)
                        ?.watchlisted
                    )}
                    onToggleWatchlist={(next) => {
                      if (!detailAssetId) return;
                      patchWatchlist.mutate({
                        assetId: detailAssetId,
                        watchlisted: next,
                      });
                    }}
                    onClose={() => setDetailAssetId(null)}
                    onEditTx={(t) => {
                      setDetailAssetId(null);
                      openEditTx(t);
                    }}
                    onDeleteTx={(id) => {
                      deleteTx.mutate(id, {
                        onSuccess: () => {
                          qc.invalidateQueries({
                            queryKey: ["asset-detail", detailAssetId],
                          });
                        },
                      });
                    }}
              onAddTransaction={(type) => {
                const h = allHoldings.find((x) => x.assetId === detailAssetId);
                setDetailAssetId(null);
                if (h) {
                  openNewTransaction(type || "ACHAT", h);
                  return;
                }
                // Fallback si position absente mais détail chargé
                const d = detailQ.data;
                if (d?.asset) {
                  const platformId =
                    d.transactions[0]?.platformId || platforms[0]?.id || "";
                  openNewTransaction(type || "ACHAT", {
                    assetId: d.asset.id,
                    name: d.asset.name,
                    ticker: d.asset.ticker,
                    assetClass: d.asset.assetClass,
                    accountType: asAccountType(
                      (d.asset as { accountType?: string }).accountType,
                      "CTO"
                    ),
                    currency: d.asset.currency,
                    platformId,
                    platformName: d.asset.platformName,
                    platformLogoUrl: d.asset.platformLogoUrl,
                    quantity: asQuantityString(d.holding?.quantity || "0"),
                    avgCostEur: asEurAmount(d.holding?.avgCostEur || "0"),
                    costBasisEur: asEurAmount("0"),
                    currentPriceEur: asPriceString(
                      d.asset.priceQuote?.priceEur || "0"
                    ),
                    currentPriceNative: asPriceString(
                      d.asset.priceQuote?.priceNative || "0"
                    ),
                    marketValueEur: asEurAmount(d.holding?.marketValueEur || "0"),
                    marketValueBase: asBaseAmount(d.holding?.marketValueEur || "0"),
                    costBasisBase: asBaseAmount("0"),
                    unrealizedPnlEur: asEurAmount("0"),
                    unrealizedPnlBase: asBaseAmount("0"),
                    unrealizedPnlPct: asPercentString("0"),
                    priceSource: null,
                    priceStatus: null,
                    lastUpdatedAt: null,
                  });
                } else {
                  openNewTransaction(type || "ACHAT");
                }
              }}
                  />
                </div>
              ) : null}
            </div>

            {tab === "banques" && <BanksTab baseCurrency={baseCurrency} />}

            {tab === "assurance-vie" && <AssuranceVieTab />}

            {tab === "epargne-salariale" && (
              <EmployeeSavingsTab baseCurrency={baseCurrency} />
            )}

            {tab === "alternatifs" && (
              <AlternativesTab baseCurrency={baseCurrency} />
            )}

            {/*
              Cockpit ou tableau de bord.

              Le choix se fait après que l'état patrimonial a répondu : tant
              qu'il est inconnu, on n'affiche ni l'un ni l'autre. Trancher plus
              tôt produirait un aller-retour visible — cockpit puis tableau de
              bord, ou l'inverse — à chaque ouverture de l'application.
            */}
            {tab === "dashboard" && !patrimonyResolved && (
              <div
                className="flex min-h-[50vh] flex-col gap-[var(--gap-section)] py-[var(--space-8)]"
                data-testid="dashboard-resolving"
                aria-busy="true"
              >
                <Skeleton className="mx-auto h-8 w-64" />
                <Skeleton className="mx-auto h-4 w-96" />
                <div className="mx-auto grid w-full max-w-3xl gap-[var(--gap-card)] sm:grid-cols-2">
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                </div>
              </div>
            )}

            {tab === "dashboard" && patrimonyResolved && patrimonyIsEmptyNow && (
              <EmptyPatrimonyCockpit
                onAddPlatform={() => {
                  setQuickPlatformTarget("standalone");
                  setQuickPlatformPrefill("");
                  setShowQuickPlatform(true);
                }}
                onAddTransaction={() => openNewTransaction("ACHAT")}
                onImport={() => setShowImport(true)}
              />
            )}

            {tab === "dashboard" && patrimonyResolved && !patrimonyIsEmptyNow && (
              <DashboardTab
                baseCurrency={baseCurrency}
                summary={summary}
                holdings={allHoldings}
                allocation={holdingsQ.data?.allocation}
                history={historyQ.data?.history ?? []}
                historyLoading={historyQ.isPending && !historyQ.data}
                maturityInput={{
                  platformCount: platforms.length,
                  transactionCount: txCount,
                  holdingCount: allHoldings.length,
                  historyPointCount: historyQ.data?.history?.length ?? 0,
                }}
                portfolioTickers={portfolioTickers}
                onAddPlatform={() => {
                  setQuickPlatformTarget("standalone");
                  setQuickPlatformPrefill("");
                  setShowQuickPlatform(true);
                }}
                onImport={() => setShowImport(true)}
                onAddTransaction={() => openNewTransaction("ACHAT")}
                onUnwatch={(assetId) =>
                  patchWatchlist.mutate({ assetId, watchlisted: false })
                }
                onNavigate={(target) => {
                  switch (target) {
                    case "positions":
                      setTab("holdings");
                      break;
                    case "transactions":
                      setTab("transactions");
                      break;
                    case "platforms":
                      setTab("platforms");
                      break;
                    case "import":
                      setShowImport(true);
                      break;
                    case "transaction":
                      openNewTransaction("ACHAT");
                      break;
                  }
                }}
                showEveryStart={showEveryStart}
                onShowEveryStartChange={(v) => {
                  setShowEveryStart(v);
                  saveUiPref(ONBOARDING_SHOW_EVERY_START_KEY, v);
                  if (v) {
                    saveUiPref(ONBOARDING_DISMISS_KEY, false);
                  }
                }}
              />
            )}

            {tab === "transactions" && (
              <TransactionsTab
                onEdit={openEditTx}
                onDelete={(id) => deleteTx.mutate(id)}
                onImport={() => setShowImport(true)}
                onCreate={() => openNewTransaction("ACHAT")}
                onOpenPlatform={() => setTab("platforms")}
                initialPlatformId={txPlatformFilter}
                platforms={platforms}
              />
            )}

            {tab === "platforms" && (
              <PlatformsTab
                platforms={platforms}
                loading={platformsQ.isPending && !platformsQ.data}
                baseCurrency={baseCurrency}
                onDelete={(p, opts) =>
                  deletePlatform.mutate({
                    id: p.id,
                    force: opts?.force,
                  })
                }
                deletePendingId={
                  deletePlatform.isPending
                    ? deletePlatform.variables?.id ?? null
                    : null
                }
                onMerged={async () => {
                  void qc.invalidateQueries({ queryKey: ["platforms"] });
                  void qc.invalidateQueries({ queryKey: ["holdings"] });
                  void qc.invalidateQueries({ queryKey: ["transactions"] });
                  await reloadHoldings(qc, baseCurrency);
                }}
                onUpdated={() => {
                  void qc.invalidateQueries({ queryKey: ["platforms"] });
                  void qc.invalidateQueries({ queryKey: ["holdings"] });
                }}
                onAddPlatform={openAddPlatform}
                onNewTransaction={(p) =>
                  openNewTransaction("ACHAT", undefined, {
                    id: p.id,
                    name: p.name,
                  })
                }
                onViewPositions={(p) =>
                  viewPositionsForPlatform({ id: p.id, name: p.name })
                }
                onImportForPlatform={(p) => {
                  setImportDefaultPlatform({ id: p.id, name: p.name });
                  setShowImport(true);
                }}
                onViewTransactions={(p) => viewTransactionsForPlatform(p)}
              />
            )}

            {tab === "liabilities" && (
              <LiabilitiesTab
                /*
                  Dénominateur du ratio dette / patrimoine. Il vient d'ici, où
                  le portefeuille est déjà chargé — le module Passifs ne
                  recalcule pas les actifs pour en rapporter la dette.
                */
                grossAssetsEur={
                  summary?.totalGrossAssetsEur != null
                    ? Number(summary.totalGrossAssetsEur)
                    : null
                }
                onOpenAsset={(assetId) => {
                  setDetailAssetId(assetId);
                  setTab("holdings");
                }}
              />
            )}

            {tab === "fiscal" && <FiscalTab baseCurrency={baseCurrency} />}
          </div>
        </div>
        </Shell>
      </div>

      <TransactionModal
        open={showTx}
        editing={Boolean(editingTxId)}
        form={txForm}
        platformLabel={txPlatformLabel}
        assetLabel={assetLabel}
        platformOptions={platformSelectOptions}
        platformsEmpty={platforms.length === 0}
        pending={saveTx.isPending}
        onClose={() => setShowTx(false)}
        onSubmit={(values) => {
          if (values.platformId) touchRecentPlatformId(values.platformId);
          saveTx.mutate(
            editingTxId ? { ...values, id: editingTxId } : values
          );
        }}
        onPlatformLabelChange={setTxPlatformLabel}
        onAssetLabelChange={setAssetLabel}
        onRequestCreatePlatform={(prefill) => {
          setQuickPlatformTarget("tx");
          setQuickPlatformPrefill(prefill || "");
          setShowQuickPlatform(true);
        }}
        onSelectCatalogPlatform={(opt) =>
          handleCatalogPlatformPick("tx", opt)
        }
        realEstatePlatformIds={realEstatePlatformIds}
        onRequestAddProperty={(platformId) => {
          setShowTx(false);
          setPropertyPlatformId(platformId);
        }}
      />

      <PropertyModal
        open={Boolean(propertyPlatformId)}
        platformId={propertyPlatformId ?? ""}
        platformName={propertyPlatformName}
        onClose={() => setPropertyPlatformId(null)}
        onCreated={(assetId) => setDetailAssetId(assetId)}
      />

      {/* Création / ajout plateforme (Mes plateformes → Ajouter une plateforme). */}
      <PlatformModal
        open={showPlatform}
        form={platformForm}
        comboLabel={platformComboLabel}
        onComboLabelChange={setPlatformComboLabel}
        onClose={() => setShowPlatform(false)}
        onSubmit={(v) => savePlatform.mutate(v)}
        pending={savePlatform.isPending}
      />

      {/*
        Import d’abord (layer 0), puis QuickPlatform au-dessus (layer 1).
        Quand création depuis import : import.suspended = true.
      */}
      <ImportCsvModal
        open={showImport}
        onClose={() => {
          // Ne pas fermer l’import si création plateforme en cours
          if (showQuickPlatform && quickPlatformTarget === "import") return;
          setShowImport(false);
        }}
        platformOptions={platformSelectOptions}
        platformsEmpty={platforms.length === 0}
        defaultPlatformId={
          importDefaultPlatform?.id || platforms[0]?.id
        }
        defaultPlatformLabel={
          importDefaultPlatform?.name || platforms[0]?.name
        }
        suspended={
          showQuickPlatform && quickPlatformTarget === "import"
        }
        onRequestCreatePlatform={(prefill) => {
          setQuickPlatformTarget("import");
          setQuickPlatformPrefill(prefill || "");
          setShowQuickPlatform(true);
        }}
        onSelectCatalogPlatform={(opt) =>
          handleCatalogPlatformPick("import", opt)
        }
        onImported={async () => {
          await qc.invalidateQueries({ queryKey: ["transactions"] });
          await qc.invalidateQueries({ queryKey: ["assets"] });
          await qc.invalidateQueries({ queryKey: ["platforms"] });
          void qc.invalidateQueries({ queryKey: ["portfolio-history"] });
          await reloadHoldings(qc, baseCurrency);
        }}
        onViewJournal={() => setTab("holdings")}
      />

      <QuickPlatformModal
        open={showQuickPlatform}
        prefillName={quickPlatformPrefill}
        context={quickPlatformTarget}
        onClose={() => setShowQuickPlatform(false)}
        onCreated={(p) => {
          if (p.created) {
            setNewPlatformIds((prev) => new Set(prev).add(p.id));
          }
          touchRecentPlatformId(p.id);
          void qc.invalidateQueries({ queryKey: ["platforms"] });
          void qc.invalidateQueries({ queryKey: ["holdings"] });
          if (quickPlatformTarget === "tx") {
            txForm.setValue("platformId", p.id, { shouldValidate: true });
            setTxPlatformLabel(p.name);
          } else if (quickPlatformTarget === "import") {
            // Réinjecte dans le champ plateforme de l’import (toujours ouvert)
            setImportDefaultPlatform({ id: p.id, name: p.name });
          }
          toast.success(
            p.created
              ? `Plateforme « ${p.name} » créée et sélectionnée`
              : `Plateforme « ${p.name} » sélectionnée`
          );
        }}
      />

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        holdings={allHoldings}
        onNavigate={setTab}
        onOpenTransaction={(type) => openNewTransaction(type)}
        onOpenImport={() => setShowImport(true)}
        onOpenPlatform={() => {
          setQuickPlatformTarget("standalone");
          setQuickPlatformPrefill("");
          setShowQuickPlatform(true);
        }}
        onOpenAsset={(id) => setDetailAssetId(id)}
      />

      <ShortcutsHelpPanel
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />
    </div>
  );
}

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
import { PLATFORM_TYPES, type AccountType } from "@/app/lib/constants";
import { formatCurrency } from "@/app/lib/utils";
import { fetchJson, reloadHoldings } from "@/app/lib/api-client";
import { usePriceAutoRefresh } from "@/app/hooks/use-price-auto-refresh";
import {
  useAssetDetailQuery,
  useHoldingsQuery,
  usePlatformsQuery,
  usePortfolioHistoryQuery,
  useTransactionsMetaQuery,
} from "@/app/hooks/use-portfolio-queries";
import {
  EMPTY_HOLDINGS,
  TAB_STORAGE_KEY,
  TAB_TO_ACCOUNT_TYPE,
  isPositionsTab,
  type Holding,
  type MainTab,
  type TxRow,
} from "@/app/lib/types/ui";
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
import { Shell } from "@/components/layout/display-provider";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { DashboardTab } from "@/components/dashboard/dashboard-tab";
import { HoldingsSection } from "@/components/holdings/holdings-section";
import { TransactionModal } from "@/components/modals/transaction-modal";
import { PlatformModal } from "@/components/modals/platform-modal";
import { AssetDetailModal } from "@/components/modals/asset-detail-modal";
import { ImportCsvModal } from "@/components/modals/import-csv-modal";
import { CommandPalette } from "@/components/layout/command-palette";
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
const LiabilitiesTab = dynamic(
  () =>
    import("@/components/tabs/liabilities-tab").then((m) => ({
      default: m.LiabilitiesTab,
    })),
  { loading: () => <TabChunkFallback />, ssr: false }
);
const EmployeeSavingsTab = dynamic(
  () =>
    import("@/components/tabs/employee-savings-tab").then((m) => ({
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
const FiscalYearTab = dynamic(
  () =>
    import("@/components/tabs/fiscal-year-tab").then((m) => ({
      default: m.FiscalYearTab,
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
    >
      <div className="border-b border-[var(--border)] bg-[var(--header-bg)] px-3 py-4 sm:px-5">
        <div className="app-shell h-10 animate-pulse rounded-lg bg-slate-200/60 dark:bg-slate-800/60" />
      </div>
      <div className="app-shell space-y-6 px-3 py-6 sm:px-5 lg:px-6">
        <div className="grid w-full min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/50"
            />
          ))}
        </div>
        <div className="card h-48 animate-pulse bg-slate-50 dark:bg-slate-900/40" />
        <div className="card h-72 animate-pulse bg-slate-50 dark:bg-slate-900/40" />
      </div>
    </div>
  );
}

/**
 * Shell portefeuille — navigation pilotée par l'URL (App Router).
 * Rendu uniquement côté client (après mount).
 */
function PortfolioAppClient({
  initialTab = "holdings",
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
  const [showImport, setShowImport] = useState(false);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const [assetLabel, setAssetLabel] = useState("");
  const [platformComboLabel, setPlatformComboLabel] = useState("");
  const [txPlatformLabel, setTxPlatformLabel] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  /** Préférence onboarding « afficher à chaque démarrage » (hero empty/setup) */
  const [showEveryStart, setShowEveryStart] = useState(true);
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

  // Prefs onboarding : après mount (client only)
  useEffect(() => {
    const { showEveryStart: every } = loadOnboardingDismissState();
    setShowEveryStart(every);
  }, []);

  // Deep-link / e2e : ?import=1 ouvre la modale CSV
  useEffect(() => {
    if (searchParams.get("import") === "1") {
      setShowImport(true);
    }
  }, [searchParams]);

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
      // Positions : URL canonique /positions?envelope=…
      if (isPositionsTab(next)) {
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

  const onEnvelopeChange = useCallback(
    (accountType: AccountType | null) => {
      if (!accountType) {
        setTab("holdings");
        return;
      }
      const opt = ENVELOPE_SELECT_OPTIONS.find((o) => o.value === accountType);
      setTab(opt?.tab ?? "holdings");
    },
    [setTab]
  );

  // ─── Data ───────────────────────────────────────────────────────────────────

  const holdingsQ = useHoldingsQuery(baseCurrency);
  const historyQ = usePortfolioHistoryQuery(baseCurrency);
  const platformsQ = usePlatformsQuery(baseCurrency);
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
    mutationFn: (body: PlatformForm) =>
      fetchJson("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Plateforme créée");
      setShowPlatform(false);
      setPlatformComboLabel("");
      platformForm.reset();
      void qc.invalidateQueries({ queryKey: ["platforms"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePlatform = useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: boolean }>(`/api/platforms?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Plateforme supprimée");
      void qc.invalidateQueries({ queryKey: ["platforms"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Derived ────────────────────────────────────────────────────────────────

  const allHoldings = holdingsQ.data?.holdings ?? EMPTY_HOLDINGS;
  const envelopeFilter: AccountType | null = TAB_TO_ACCOUNT_TYPE[tab] ?? null;

  const holdings = useMemo(() => {
    if (!envelopeFilter) return allHoldings;
    return allHoldings.filter((h) => (h.accountType || "CTO") === envelopeFilter);
  }, [allHoldings, envelopeFilter]);

  /** Tickers uniques pour le calendrier des résultats (dashboard) */
  const portfolioTickers = useMemo(() => {
    const seen = new Set<string>();
    const out: { ticker: string; name: string }[] = [];
    for (const h of allHoldings) {
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

  const positionsView = isPositionsTab(tab);
  const isDashboard = tab === "dashboard";

  /** Maturité du compte → densité du dashboard + KPI strip */
  const dashboardMaturity = resolveDashboardMaturity({
    platformCount: platforms.length,
    transactionCount: txCount,
    holdingCount: allHoldings.length,
    historyPointCount: historyQ.data?.history?.length ?? 0,
  });
  const dashBlocks = dashboardBlocksFor(dashboardMaturity);
  /** KPI globaux : toujours hors dashboard ; sur dashboard seulement si mature */
  const showGlobalKpis = !isDashboard || dashBlocks.showKpiStrip;

  const platformSelectOptions = useMemo(
    () =>
      platforms.map((p) => ({
        value: p.id,
        label: p.name,
        subtitle: [
          PLATFORM_TYPES[p.type as keyof typeof PLATFORM_TYPES] || p.type,
          p.subtype,
        ]
          .filter(Boolean)
          .join(" · "),
        logoUrl: p.logoUrl,
      })),
    [platforms]
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

  function openNewTransaction(type?: string, prefill?: Holding) {
    setEditingTxId(null);
    void qc.invalidateQueries({ queryKey: ["platforms"] });
    void qc.invalidateQueries({ queryKey: ["assets"] });
    const txType = (type || "ACHAT") as CreateTransactionForm["type"];
    const platformId = prefill?.platformId || platforms[0]?.id || "";
    const platformName =
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen min-w-0 max-w-[100vw] overflow-x-clip text-[var(--foreground)]">
      <AppHeader
        tab={tab}
        onTabChange={setTab}
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

      <Shell>
        {/*
          KPI strip :
          - onglets métier : toujours
          - dashboard empty/setup : masqué (réduit la densité perçue)
          - dashboard active : cockpit complet
        */}
        {showGlobalKpis && (
          <KpiStrip
            summary={summary}
            baseCurrency={baseCurrency}
            smartFilter={isDashboard && dashBlocks.kpiSmartFilter}
          />
        )}

        <div data-slot="positions">
          {positionsView ? (
            <HoldingsSection
              tab={tab}
              holdings={holdings}
              loading={holdingsQ.isPending && !holdingsQ.data}
              baseCurrency={baseCurrency}
              envelopeFilter={envelopeFilter}
              onAccountTypeChange={onAccountTypeChange}
              onTriggerLevelChange={onTriggerLevelChange}
              onRowDoubleClick={setDetailAssetId}
              onEnvelopeChange={onEnvelopeChange}
              onOpenTransactionForAsset={(type, h) =>
                openNewTransaction(type, h)
              }
              onCategoryChange={onCategoryChange}
              onAddTransaction={() => openNewTransaction("ACHAT")}
              onImport={() => setShowImport(true)}
            />
          ) : null}
        </div>

        {tab === "banques" && <BanksTab baseCurrency={baseCurrency} />}

        {tab === "epargne-salariale" && (
          <EmployeeSavingsTab baseCurrency={baseCurrency} />
        )}

        {tab === "alternatifs" && (
          <AlternativesTab baseCurrency={baseCurrency} />
        )}

        {tab === "dashboard" && (
          <DashboardTab
            baseCurrency={baseCurrency}
            summary={summary}
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
              setTab("platforms");
              setShowPlatform(true);
            }}
            onImport={() => setShowImport(true)}
            onAddTransaction={() => openNewTransaction("ACHAT")}
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
          />
        )}

        {tab === "platforms" && (
          <PlatformsTab
            platforms={platforms}
            baseCurrency={baseCurrency}
            onAdd={() => setShowPlatform(true)}
            onDelete={(p) => deletePlatform.mutate(p.id)}
            deletePendingId={
              deletePlatform.isPending ? deletePlatform.variables ?? null : null
            }
          />
        )}

        {tab === "liabilities" && <LiabilitiesTab baseCurrency={baseCurrency} />}

        {tab === "fiscal" && <FiscalYearTab baseCurrency={baseCurrency} />}
      </Shell>

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
          saveTx.mutate(
            editingTxId ? { ...values, id: editingTxId } : values
          );
        }}
        onPlatformLabelChange={setTxPlatformLabel}
        onAssetLabelChange={setAssetLabel}
      />

      <PlatformModal
        open={showPlatform}
        form={platformForm}
        comboLabel={platformComboLabel}
        onComboLabelChange={setPlatformComboLabel}
        onClose={() => setShowPlatform(false)}
        onSubmit={(v) => savePlatform.mutate(v)}
      />

      <AssetDetailModal
        open={Boolean(detailAssetId)}
        loading={detailQ.isPending && !detailQ.data}
        data={detailQ.data}
        onClose={() => setDetailAssetId(null)}
        onEditTx={(t) => {
          setDetailAssetId(null);
          openEditTx(t);
        }}
        onDeleteTx={(id) => {
          deleteTx.mutate(id, {
            onSuccess: () => {
              qc.invalidateQueries({ queryKey: ["asset-detail", detailAssetId] });
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
              accountType:
                (d.asset as { accountType?: string }).accountType || "CTO",
              currency: d.asset.currency,
              platformId,
              platformName: d.asset.platformName,
              platformLogoUrl: d.asset.platformLogoUrl,
              quantity: d.holding?.quantity || "0",
              avgCostEur: d.holding?.avgCostEur || "0",
              costBasisEur: "0",
              currentPriceEur: d.asset.priceQuote?.priceEur || "0",
              currentPriceNative: d.asset.priceQuote?.priceNative || "0",
              marketValueEur: d.holding?.marketValueEur || "0",
              marketValueBase: d.holding?.marketValueEur || "0",
              costBasisBase: "0",
              unrealizedPnlEur: "0",
              unrealizedPnlBase: "0",
              unrealizedPnlPct: "0",
              priceSource: null,
              priceStatus: null,
              lastUpdatedAt: null,
            });
          } else {
            openNewTransaction(type || "ACHAT");
          }
        }}
      />

      <ImportCsvModal
        open={showImport}
        onClose={() => setShowImport(false)}
        platformOptions={platformSelectOptions}
        platformsEmpty={platforms.length === 0}
        defaultPlatformId={platforms[0]?.id}
        defaultPlatformLabel={platforms[0]?.name}
        onImported={async () => {
          await qc.invalidateQueries({ queryKey: ["transactions"] });
          await qc.invalidateQueries({ queryKey: ["assets"] });
          void qc.invalidateQueries({ queryKey: ["portfolio-history"] });
          await reloadHoldings(qc, baseCurrency);
          setTab("transactions");
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
          setTab("platforms");
          setShowPlatform(true);
        }}
        onOpenAsset={(id) => setDetailAssetId(id)}
      />
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Loader2,
  Wallet,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PlatformCombobox } from "@/components/ui/platform-combobox";
import { PlatformLogo } from "@/components/ui/platform-logo";
import {
  IMPORT_FORMATS,
  type ImportFormatId,
  type ColumnRole,
} from "@/app/lib/import/presets";
import type { ImportDraftRow } from "@/app/lib/import/map-rows";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { decodeCsvBuffer } from "@/app/lib/import/normalize";
import {
  loadSavedColumnMap,
  saveColumnMap,
} from "@/app/lib/import/mapping-store";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import {
  cn,
  formatCurrency,
  formatCurrencyPrecise,
  formatDate,
  formatQuantity,
} from "@/app/lib/utils";
import { fetchJson } from "@/app/lib/api-client";
import {
  availableApiStatusMessage,
  blockchainCatalogPresets,
  DEFAULT_ZERION_API_KEY,
  describeChainSyncFeatures,
  getChainSyncCapability,
  missingApiStatusMessage,
  ZERION_HELP_MESSAGE,
} from "@/app/lib/market/chain-wallet-sync";
import type { SolanaPortfolioSnapshot } from "@/app/lib/solana";

const PREVIEW_PAGE_SIZES = [20, 50, 100, 200] as const;
type PreviewPageSize = (typeof PREVIEW_PAGE_SIZES)[number];

type ProgressStepId =
  | "read"
  | "detect"
  | "validate"
  | "import"
  | "done";

type ProgressState = {
  active: ProgressStepId | null;
  /** 0–100 pour la barre */
  percent: number;
  /** détail optionnel (lignes traitées, etc.) */
  detail?: string;
};

const PROGRESS_STEPS: {
  id: ProgressStepId;
  label: string;
}[] = [
  { id: "read", label: "Lecture du fichier" },
  { id: "detect", label: "Détection des colonnes" },
  { id: "validate", label: "Validation des données" },
  { id: "import", label: "Import en base" },
];

type SuspectRow = {
  line: number;
  deltaMs: number;
  draft: {
    line: number;
    type: string | null;
    occurredAt: string | null;
    ticker: string | null;
    name: string | null;
    quantity: string | null;
    unitPrice: string | null;
    fees: string;
    currency: string;
    cashAmount: string | null;
    notes: string | null;
  };
  existing: {
    id: string;
    type: string;
    occurredAt: string;
    quantity: string | null;
    unitPrice: string | null;
    fees: string;
    currency: string;
    ticker: string | null;
    notes: string | null;
  };
};

type PlatformOption = {
  value: string;
  label: string;
  subtitle?: string;
  logoUrl?: string | null;
  isNew?: boolean;
  isCatalog?: boolean;
  preset?: import("@/app/lib/platforms/presets").PlatformPreset;
};

const MAPPABLE_ROLES: { id: ColumnRole; label: string; required?: boolean }[] =
  [
    { id: "date", label: "Date", required: true },
    { id: "type", label: "Type d'opération", required: true },
    { id: "side", label: "Sens (Buy/Sell)" },
    { id: "ticker", label: "Ticker / ISIN", required: true },
    { id: "name", label: "Nom actif" },
    { id: "quantity", label: "Quantité", required: true },
    { id: "unitPrice", label: "Prix unitaire", required: true },
    { id: "fees", label: "Frais" },
    { id: "currency", label: "Devise" },
    { id: "cashAmount", label: "Montant total" },
    { id: "platform", label: "Plateforme / courtier" },
    { id: "notes", label: "Notes" },
    { id: "description", label: "Description" },
    { id: "ignore", label: "— Ignorer —" },
  ];

const REQUIRED_ROLES: ColumnRole[] = [
  "date",
  "type",
  "ticker",
  "quantity",
  "unitPrice",
];

type PreviewResponse = {
  headers: string[];
  delimiter: string;
  formatId?: string;
  detectedFormatId?: string | null;
  formatLabel: string;
  columnMap: Record<string, string>;
  confidence?: string;
  needsManualMapping?: boolean;
  needsFormatConfirm?: boolean;
  ambiguousFormats?: Array<{ id: string; score: number; label: string }>;
  rows: ImportDraftRow[];
  totalRows: number;
  truncated: boolean;
  previewLimit?: number;
  stats: { ok: number; warning: number; error: number };
  warnings?: string[];
};

type CreatedPlatformRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  logoDraft?: string;
  saving?: boolean;
};

type ImportSuccessSummary = {
  created: number;
  assetsCreated: number;
  duplicates: number;
  skipped: number;
  errors: number;
  /** Montant total estimé des lignes importables (EUR si possible) */
  totalAmountLabel: string;
  fileName: string;
  platformsCreated: CreatedPlatformRow[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Rôles présents dans le mapping (header → role). */
function mappedRoles(map: Record<string, string>): Set<string> {
  return new Set(Object.values(map).filter(Boolean));
}

function missingRequiredRoles(map: Record<string, string>): ColumnRole[] {
  const roles = mappedRoles(map);
  // ticker peut être remplacé par name pour certains formats cash — on exige ticker
  // OU (quantity+unitPrice) déjà listés. date+type toujours.
  return REQUIRED_ROLES.filter((r) => !roles.has(r));
}

function estimateTotalAmount(rows: ImportDraftRow[]): number {
  let total = 0;
  for (const r of rows) {
    if (!r.selected || r.status === "error") continue;
    if (r.cashAmount != null && r.cashAmount !== "") {
      const n = Number(r.cashAmount);
      if (Number.isFinite(n)) {
        total += Math.abs(n);
        continue;
      }
    }
    const q = Number(r.quantity);
    const p = Number(r.unitPrice);
    if (Number.isFinite(q) && Number.isFinite(p)) {
      total += Math.abs(q * p);
    }
  }
  return total;
}

/** Aperçu brut des N premières lignes CSV (avant mapping métier). */
function rawPreviewRows(
  csvText: string,
  headers: string[],
  delimiter: string,
  n = 5
): string[][] {
  try {
    const parsed = parseCsv(csvText, delimiter);
    return parsed.rows.slice(0, n).map((row) =>
      headers.map((h) => String(row[h] ?? "").slice(0, 80))
    );
  } catch {
    return [];
  }
}

function ImportProgressBar({
  progress,
}: {
  progress: ProgressState;
}) {
  if (!progress.active) return null;
  const activeIdx = PROGRESS_STEPS.findIndex((s) => s.id === progress.active);
  return (
    <div
      className="rounded-xl border border-teal-500/25 bg-teal-950/20 px-3 py-3"
      data-testid="import-progress"
      role="status"
      aria-live="polite"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-teal-100">
          {PROGRESS_STEPS[activeIdx]?.label || "Traitement…"}
        </span>
        <span className="tabular-nums text-teal-200/80">
          {Math.round(progress.percent)}%
          {progress.detail ? ` · ${progress.detail}` : ""}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400 transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
        />
      </div>
      <ol className="mt-3 flex flex-wrap gap-1.5">
        {PROGRESS_STEPS.map((step, i) => {
          const done = activeIdx > i || progress.active === "done";
          const current = step.id === progress.active;
          return (
            <li
              key={step.id}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                done &&
                  "bg-teal-500/15 text-teal-200 ring-teal-500/30",
                current &&
                  !done &&
                  "bg-teal-500/25 text-teal-50 ring-teal-400/50",
                !done &&
                  !current &&
                  "bg-slate-800/60 text-slate-500 ring-slate-700"
              )}
            >
              {done ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : current ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <span className="inline-block h-3 w-3 text-center text-[9px] opacity-60">
                  {i + 1}
                </span>
              )}
              {step.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ImportCsvModal({
  open,
  onClose,
  platformOptions,
  platformsEmpty,
  defaultPlatformId,
  defaultPlatformLabel,
  onImported,
  onViewJournal,
  onRequestCreatePlatform,
  onSelectCatalogPlatform,
  /** Création plateforme au premier plan — import en arrière-plan */
  suspended = false,
}: {
  open: boolean;
  onClose: () => void;
  platformOptions: PlatformOption[];
  platformsEmpty: boolean;
  defaultPlatformId?: string;
  defaultPlatformLabel?: string;
  /** Rafraîchir les données après import (sans imposer la navigation). */
  onImported: () => void | Promise<void>;
  /** Navigation post-import (positions — le journal reste un historique). */
  onViewJournal?: () => void;
  onRequestCreatePlatform?: (prefill?: string) => void;
  onSelectCatalogPlatform?: (opt: PlatformOption) => void | Promise<void>;
  suspended?: boolean;
}) {
  const [formatId, setFormatId] = useState<ImportFormatId | "auto">("auto");
  const [platformId, setPlatformId] = useState(defaultPlatformId || "");
  const [platformLabel, setPlatformLabel] = useState(
    defaultPlatformLabel || ""
  );
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [rows, setRows] = useState<ImportDraftRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [manualMap, setManualMap] = useState<Record<string, ColumnRole>>({});
  const [showMapper, setShowMapper] = useState(false);
  const [pageSize, setPageSize] = useState<PreviewPageSize>(50);
  const [pageIndex, setPageIndex] = useState(0);
  const [suspects, setSuspects] = useState<SuspectRow[]>([]);
  const [acceptSuspect, setAcceptSuspect] = useState<Record<number, boolean>>(
    {}
  );
  const [analyzeInfo, setAnalyzeInfo] = useState<{
    toCreateCount: number;
    strictCount: number;
    suspectCount: number;
  } | null>(null);
  const [phase, setPhase] = useState<"preview" | "suspects" | "success">(
    "preview"
  );
  const [progress, setProgress] = useState<ProgressState>({
    active: null,
    percent: 0,
  });
  const [successSummary, setSuccessSummary] =
    useState<ImportSuccessSummary | null>(null);

  /** csv = import fichier ; wallet = ajout plateforme blockchain par adresse */
  const [importMode, setImportMode] = useState<"csv" | "wallet">("csv");
  const [walletPresetKey, setWalletPresetKey] = useState("SOLANA");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletApiKey, setWalletApiKey] = useState(DEFAULT_ZERION_API_KEY);
  const [walletMoneroAmount, setWalletMoneroAmount] = useState("");
  const [walletPending, setWalletPending] = useState(false);
  const [walletResult, setWalletResult] = useState<{
    platformId: string;
    platformName: string;
    synced: boolean;
    notice?: string | null;
    snapshot?: SolanaPortfolioSnapshot | null;
    /** Résumé générique (Zerion / multi) */
    summaryLine?: string | null;
  } | null>(null);

  const chainPresets = useMemo(() => blockchainCatalogPresets(), []);
  const selectedChainCap = useMemo(
    () => getChainSyncCapability(walletPresetKey),
    [walletPresetKey]
  );
  const selectedChainPreset = useMemo(
    () => chainPresets.find((p) => p.key === walletPresetKey),
    [chainPresets, walletPresetKey]
  );

  // Sync destination when parent crée une plateforme à la volée
  // (y compris juste après fermeture de la modale de création)
  useEffect(() => {
    if (!open) return;
    if (defaultPlatformId && defaultPlatformId !== platformId) {
      setPlatformId(defaultPlatformId);
      setPlatformLabel(defaultPlatformLabel || "");
    } else if (
      defaultPlatformLabel &&
      defaultPlatformId === platformId &&
      defaultPlatformLabel !== platformLabel
    ) {
      setPlatformLabel(defaultPlatformLabel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync intentional when default changes
  }, [open, defaultPlatformId, defaultPlatformLabel, suspended]);

  useEffect(() => {
    if (!open) {
      setImportMode("csv");
      setWalletAddress("");
      setWalletResult(null);
      setWalletPending(false);
    }
  }, [open]);

  const selectedCount = useMemo(
    () => rows.filter((r) => r.selected).length,
    [rows]
  );

  const importableCount = useMemo(() => {
    if (!preview) return selectedCount;
    if (!preview.truncated) return selectedCount;
    const deselectedInPreview = rows.filter(
      (r) =>
        !r.selected &&
        r.status !== "error" &&
        r.type !== "TRANSFERT_CASH" &&
        r.type !== "TRANSFERT_TITRE"
    ).length;
    const validTotal = preview.stats.ok + preview.stats.warning;
    return Math.max(0, validTotal - deselectedInPreview);
  }, [preview, rows, selectedCount]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = useMemo(() => {
    const start = pageIndex * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, pageIndex, pageSize]);

  const missingRoles = useMemo(
    () => missingRequiredRoles(manualMap),
    [manualMap]
  );
  const mappingReady = missingRoles.length === 0;

  const sampleRaw = useMemo(() => {
    if (!preview?.headers?.length || !csvText) return [];
    return rawPreviewRows(
      csvText,
      preview.headers,
      preview.delimiter || ",",
      5
    );
  }, [preview, csvText]);

  if (!open) return null;

  function reset() {
    setFileName("");
    setCsvText("");
    setPreview(null);
    setRows([]);
    setManualMap({});
    setShowMapper(false);
    setPageIndex(0);
    setPageSize(50);
    setSuspects([]);
    setAcceptSuspect({});
    setAnalyzeInfo(null);
    setPhase("preview");
    setProgress({ active: null, percent: 0 });
    setSuccessSummary(null);
  }

  function buildRowSelection(): Record<string, boolean> {
    const rowSelection: Record<string, boolean> = {};
    for (const r of rows) {
      rowSelection[String(r.line)] = Boolean(r.selected);
    }
    return rowSelection;
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setProgress({
      active: "read",
      percent: 8,
      detail: file.name,
    });
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      setProgress({
        active: "read",
        percent: 22,
        detail: `${Math.round(buf.byteLength / 1024)} Ko`,
      });
      await sleep(80);
      const text = decodeCsvBuffer(buf);
      setCsvText(text);
      setPreview(null);
      setRows([]);
      setManualMap({});
      setShowMapper(false);
      setSuccessSummary(null);
      setPhase("preview");
      const lineHint = text.split(/\r?\n/).filter((l) => l.trim()).length;
      setProgress({
        active: "read",
        percent: 35,
        detail: `~${Math.max(0, lineHint - 1)} ligne(s)`,
      });
      await sleep(60);
      setProgress({ active: null, percent: 0 });
    } catch {
      setProgress({ active: null, percent: 0 });
      toast.error("Impossible de lire le fichier");
    }
  }

  async function runPreview(overrideMap?: Record<string, ColumnRole>) {
    if (!csvText.trim()) {
      toast.error("Choisissez un fichier CSV");
      return;
    }
    setLoadingPreview(true);
    setProgress({
      active: "detect",
      percent: 40,
      detail: "Auto-détection du format…",
    });
    try {
      const columnMap =
        overrideMap ||
        (Object.keys(manualMap).length ? manualMap : null);

      await sleep(100);
      setProgress({
        active: "detect",
        percent: 55,
        detail: "Mapping des colonnes…",
      });

      const data = await fetchJson<PreviewResponse>("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText,
          formatId,
          columnMap: columnMap || undefined,
        }),
      });

      setProgress({
        active: "validate",
        percent: 75,
        detail: `${data.totalRows} ligne(s) analysée(s)`,
      });
      await sleep(80);

      if (!columnMap && data.headers?.length) {
        const saved = loadSavedColumnMap(data.headers);
        if (saved && Object.keys(saved).length > 0) {
          setProgress({
            active: "validate",
            percent: 82,
            detail: "Mapping mémorisé…",
          });
          const retry = await fetchJson<PreviewResponse>(
            "/api/import/preview",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                csvText,
                formatId,
                columnMap: saved,
              }),
            }
          );
          const baseScore =
            data.stats.ok * 2 + data.stats.warning - data.stats.error * 3;
          const savedScore =
            retry.stats.ok * 2 +
            retry.stats.warning -
            retry.stats.error * 3;
          if (
            savedScore >= baseScore &&
            retry.stats.error <= data.stats.error
          ) {
            setPreview(retry);
            setRows(retry.rows);
            setManualMap(saved as Record<string, ColumnRole>);
            const miss = missingRequiredRoles(
              saved as Record<string, string>
            );
            setShowMapper(
              Boolean(retry.needsManualMapping) ||
                miss.length > 0 ||
                retry.confidence === "low"
            );
            setPageIndex(0);
            setPhase("preview");
            setProgress({
              active: "validate",
              percent: 100,
              detail: `${retry.stats.ok} OK · ${retry.stats.error} erreur(s)`,
            });
            await sleep(200);
            setProgress({ active: null, percent: 0 });
            toast.success(
              `Analyse (mapping mémorisé) : ${retry.stats.ok} OK · ${retry.stats.warning} avert. · ${retry.stats.error} erreur(s)`
            );
            return;
          }
        }
      }

      setPreview(data);
      setRows(data.rows);
      setPageIndex(0);
      setPhase("preview");
      setSuspects([]);
      setAnalyzeInfo(null);
      setManualMap((data.columnMap || {}) as Record<string, ColumnRole>);
      const miss = missingRequiredRoles(data.columnMap || {});
      setShowMapper(
        Boolean(data.needsManualMapping) ||
          data.confidence === "low" ||
          miss.length > 0
      );
      setProgress({
        active: "validate",
        percent: 100,
        detail: `${data.stats.ok} OK · ${data.stats.error} erreur(s)`,
      });
      await sleep(200);
      setProgress({ active: null, percent: 0 });
      toast.success(
        `Analyse : ${data.stats.ok} OK · ${data.stats.warning} avert. · ${data.stats.error} erreur(s)` +
          (data.confidence ? ` · confiance ${data.confidence}` : "")
      );
    } catch (e) {
      setProgress({ active: null, percent: 0 });
      toast.error(e instanceof Error ? e.message : "Échec de l'analyse");
    } finally {
      setLoadingPreview(false);
    }
  }

  function applyManualMapping() {
    if (!preview?.headers?.length) return;
    if (missingRequiredRoles(manualMap).length > 0) {
      toast.error(
        `Colonnes obligatoires manquantes : ${missingRequiredRoles(manualMap)
          .map(
            (r) => MAPPABLE_ROLES.find((x) => x.id === r)?.label || r
          )
          .join(", ")}`
      );
      return;
    }
    saveColumnMap(preview.headers, manualMap, fileName || "import");
    toast.message("Mapping enregistré pour les prochains imports similaires");
    void runPreview(manualMap);
  }

  async function runAnalyzeAndMaybeCommit() {
    if (!platformId) {
      toast.error("Sélectionnez une plateforme de destination");
      return;
    }
    if (!mappingReady) {
      toast.error("Complétez le mapping des colonnes obligatoires");
      setShowMapper(true);
      return;
    }
    if (importableCount === 0) {
      toast.error("Aucune ligne valide à importer");
      return;
    }
    if (!csvText.trim()) {
      toast.error("Fichier CSV manquant — rechargez le fichier");
      return;
    }
    setCommitting(true);
    setProgress({
      active: "import",
      percent: 15,
      detail: "Analyse des doublons…",
    });
    try {
      const payload = {
        platformId,
        csvText,
        formatId: preview?.formatId || formatId,
        delimiter: preview?.delimiter,
        columnMap: manualMap,
        rowSelection: buildRowSelection(),
      };

      const analysis = await fetchJson<{
        toCreateCount: number;
        strictCount: number;
        suspectCount: number;
        suspects: SuspectRow[];
      }>("/api/import/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setAnalyzeInfo({
        toCreateCount: analysis.toCreateCount,
        strictCount: analysis.strictCount,
        suspectCount: analysis.suspectCount,
      });

      setProgress({
        active: "import",
        percent: 40,
        detail: `${analysis.toCreateCount} à créer · ${analysis.strictCount} doublon(s)`,
      });

      if (analysis.suspectCount > 0) {
        setSuspects(analysis.suspects);
        const initial: Record<number, boolean> = {};
        for (const s of analysis.suspects) initial[s.line] = false;
        setAcceptSuspect(initial);
        setPhase("suspects");
        setProgress({ active: null, percent: 0 });
        toast.message(
          `${analysis.strictCount} doublon(s) exact(s) ignoré(s) · ${analysis.suspectCount} suspicion(s) à trancher`
        );
        return;
      }

      await finishCommit([]);
    } catch (e) {
      setProgress({ active: null, percent: 0 });
      toast.error(e instanceof Error ? e.message : "Échec de l'analyse");
    } finally {
      setCommitting(false);
    }
  }

  async function finishCommit(acceptSuspectLines: number[]) {
    setCommitting(true);
    setProgress({
      active: "import",
      percent: 55,
      detail: "Écriture en base…",
    });
    try {
      const totalHint = estimateTotalAmount(
        rows.filter((r) => r.selected && r.status !== "error")
      );

      const result = await fetchJson<{
        created: number;
        skipped: number;
        duplicates?: number;
        strictDuplicates?: number;
        assetsCreated: number;
        platformsCreated?: Array<{
          id: string;
          name: string;
          logoUrl: string | null;
        }>;
        totalDrafts?: number;
        errors: Array<{ line: number; message: string }>;
      }>("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId,
          csvText,
          formatId: preview?.formatId || formatId,
          delimiter: preview?.delimiter,
          columnMap: manualMap,
          rowSelection: buildRowSelection(),
          skipDuplicates: true,
          acceptSuspectLines,
        }),
      });

      setProgress({
        active: "import",
        percent: 95,
        detail: `${result.created} transaction(s)`,
      });
      await sleep(150);

      const dup = result.duplicates ?? 0;
      setSuccessSummary({
        created: result.created,
        assetsCreated: result.assetsCreated,
        duplicates: dup,
        skipped: result.skipped,
        errors: result.errors.length,
        totalAmountLabel:
          totalHint > 0
            ? formatCurrencyPrecise(totalHint, "EUR")
            : "—",
        fileName: fileName || "import.csv",
        platformsCreated: (result.platformsCreated || []).map((p) => ({
          ...p,
          logoDraft: p.logoUrl || "",
        })),
      });
      setPhase("success");
      setProgress({ active: "done", percent: 100 });

      if (result.errors.length > 0) {
        toast.message(
          `${result.errors.length} ligne(s) en échec (ex. L${result.errors[0].line} : ${result.errors[0].message})`
        );
      }
      await onImported();
    } catch (e) {
      setProgress({ active: null, percent: 0 });
      toast.error(e instanceof Error ? e.message : "Échec de l'import");
    } finally {
      setCommitting(false);
    }
  }

  function toggleRow(line: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.line === line && r.status !== "error"
          ? { ...r, selected: !r.selected }
          : r
      )
    );
  }

  function selectAllValid(select: boolean) {
    setRows((prev) =>
      prev.map((r) =>
        r.status === "error" ||
        r.type === "TRANSFERT_CASH" ||
        r.type === "TRANSFERT_TITRE"
          ? r
          : { ...r, selected: select }
      )
    );
  }

  function closeAll() {
    reset();
    setImportMode("csv");
    setWalletAddress("");
    setWalletResult(null);
    setWalletPending(false);
    onClose();
  }

  function goToJournal() {
    onViewJournal?.();
    closeAll();
  }

  async function submitWalletPlatform(e: React.FormEvent) {
    e.preventDefault();
    const preset = selectedChainPreset;
    if (!preset) {
      toast.error("Choisissez une blockchain");
      return;
    }
    const cap = getChainSyncCapability(preset.key);
    const addr = walletAddress.trim();
    // Clé préremplie : l’utilisateur n’a PAS besoin de la saisir pour que ça marche
    const apiKey = walletApiKey.trim() || DEFAULT_ZERION_API_KEY;

    // ── Monero ────────────────────────────────────────────────────────────
    if (cap?.provider === "monero-manual") {
      const amt = Number(String(walletMoneroAmount).replace(",", "."));
      if (!Number.isFinite(amt) || amt < 0) {
        toast.error("Indiquez un solde XMR valide");
        return;
      }
      setWalletPending(true);
      setWalletResult(null);
      try {
        const created = await fetchJson<{
          platform: { id: string; name: string };
        }>("/api/platforms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: preset.name,
            type: "BLOCKCHAIN",
            subtype: preset.subtype || null,
            logoKey: preset.key,
            logoUrl: preset.logoUrl,
            walletAddress: addr || null,
            upsert: true,
          }),
        });
        const sync = await fetchJson<{
          ledger?: { assetsTouched?: number } | null;
          ledgerError?: string | null;
        }>("/api/wallets/monero/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platformId: created.platform.id,
            amount: amt,
            writeLedger: true,
          }),
        });
        const n = sync.ledger?.assetsTouched ?? 0;
        setWalletResult({
          platformId: created.platform.id,
          platformName: created.platform.name,
          synced: true,
          notice: sync.ledgerError
            ? sync.ledgerError
            : `${n} position(s) XMR · solde ${amt}`,
          snapshot: null,
        });
        toast.success(`Monero · ${n} position(s)`);
        await onImported();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Échec Monero");
      } finally {
        setWalletPending(false);
      }
      return;
    }

    if (!addr) {
      toast.error("Saisissez l’adresse du wallet");
      return;
    }
    if (cap && !cap.validateAddress(addr)) {
      toast.error(`Adresse invalide pour ${cap.label}`);
      return;
    }

    setWalletPending(true);
    setWalletResult(null);
    try {
      const created = await fetchJson<{
        platform: {
          id: string;
          name: string;
          type: string;
          walletAddress?: string | null;
        };
        created?: boolean;
      }>("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          type: "BLOCKCHAIN",
          subtype: preset.subtype || null,
          logoKey: preset.key,
          logoUrl: preset.logoUrl,
          walletAddress: addr,
          walletApiKey: cap?.provider === "zerion" ? apiKey : null,
          upsert: true,
        }),
      });

      const platformId = created.platform.id;
      const platformName = created.platform.name;
      const persistedWallet = (created.platform.walletAddress || "").trim();

      if (persistedWallet !== addr || cap?.provider === "zerion") {
        await fetchJson("/api/platforms", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: platformId,
            walletAddress: addr,
            ...(cap?.provider === "zerion" ? { walletApiKey: apiKey } : {}),
          }),
        });
      }

      if (!cap?.syncPath) {
        toast.message(missingApiStatusMessage());
        setWalletResult({
          platformId,
          platformName,
          synced: false,
          notice: missingApiStatusMessage(),
          snapshot: null,
        });
        await onImported();
        return;
      }

      try {
        if (cap.provider === "zerion") {
          // Zerion EVM : clé API + multi-chain obligatoires
          const sync = await fetchJson<{
            ok: boolean;
            ledgerWritten?: boolean;
            ledgerError?: string | null;
            ledger?: { assetsTouched: number; txsCreated: number } | null;
            history?: { historyTxsCreated?: number } | null;
            summary?: {
              balances?: number;
              transactions?: number;
              assetsTouched?: number;
              historyTxs?: number;
            };
            portfolio?: {
              balances?: unknown[];
              transactions?: unknown[];
            };
          }>(cap.syncPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platformId,
              address: addr,
              apiKey,
              chainPreset: preset.key,
              allChains: false,
              writeLedger: true,
            }),
          });
          const nBal =
            sync.summary?.balances ?? sync.portfolio?.balances?.length ?? 0;
          const nTx =
            sync.summary?.transactions ??
            sync.portfolio?.transactions?.length ??
            0;
          const nAssets =
            sync.summary?.assetsTouched ?? sync.ledger?.assetsTouched ?? 0;
          const nHist =
            sync.summary?.historyTxs ??
            sync.history?.historyTxsCreated ??
            0;
          const notice = sync.ledgerError
            ? `API : ${nBal} solde(s) · ledger : ${sync.ledgerError}`
            : `${nAssets} position(s) · ${nBal} solde(s) · ${nHist} tx journal · ${nTx} tx API`;
          setWalletResult({
            platformId,
            platformName,
            synced: true,
            notice,
            snapshot: null,
            summaryLine: notice,
          });
          if (sync.ledgerError) {
            toast.message(`Wallet enregistré — ${notice}`);
          } else if (nBal === 0 && nTx === 0) {
            toast.message(
              "Wallet enregistré — Zerion n’a renvoyé aucun solde (adresse / clé ?)"
            );
          } else {
            toast.success(`Wallet ${preset.name} · ${notice}`);
          }
        } else {
          // Solana Helius
          const sync = await fetchJson<{
            ok: boolean;
            snapshot: SolanaPortfolioSnapshot;
            ledgerWritten?: boolean;
            ledgerError?: string | null;
            ledger?: { assetsTouched: number; txsCreated: number } | null;
            txSync?: { newTransactions?: number } | null;
          }>(cap.syncPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platformId,
              address: addr,
              writeLedger: true,
              syncTransactions: true,
            }),
          });
          const ledgerOk = Boolean(sync.ledgerWritten && sync.ledger);
          const txN = sync.txSync?.newTransactions ?? 0;
          setWalletResult({
            platformId,
            platformName,
            synced: true,
            notice: ledgerOk
              ? `${sync.ledger!.assetsTouched} position(s)` +
                (txN > 0 ? ` · ${txN} tx on-chain` : "")
              : sync.ledgerError
                ? `Snapshot OK — ${sync.ledgerError}`
                : sync.snapshot?.notice || "Snapshot récupéré",
            snapshot: sync.snapshot ?? null,
          });
          if (ledgerOk) {
            toast.success(
              `Wallet ${preset.name} · ${sync.ledger!.assetsTouched} position(s)`
            );
          } else if (sync.ledgerError) {
            toast.message(`Wallet enregistré — ${sync.ledgerError}`);
          } else {
            toast.success(`Wallet ${preset.name} enregistré`);
          }
        }
      } catch (syncErr) {
        const msg =
          syncErr instanceof Error
            ? syncErr.message
            : "Synchro snapshot indisponible";
        setWalletResult({
          platformId,
          platformName,
          synced: false,
          notice: `Plateforme enregistrée, synchro en échec : ${msg}`,
          snapshot: null,
        });
        toast.error(`Synchro échouée : ${msg}`);
      }
      await onImported();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Échec de l’ajout du wallet"
      );
    } finally {
      setWalletPending(false);
    }
  }

  return (
    <Modal
      title={
        phase === "success"
          ? "Import terminé"
          : importMode === "wallet"
            ? "Ajouter un wallet blockchain"
            : "Importer des transactions (CSV)"
      }
      onClose={closeAll}
      wide
      layer={0}
      suspended={suspended}
    >
      <div className="space-y-4" data-testid="import-csv-modal">
        {suspended && (
          <p
            className="rounded-lg border border-teal-500/25 bg-teal-500/10 px-3 py-2 text-[11px] leading-relaxed text-teal-900 dark:text-teal-100"
            data-testid="import-suspended-hint"
          >
            Import en pause — créez d’abord la plateforme, puis vous
            poursuivrez ici automatiquement.
          </p>
        )}

        {phase !== "success" && (
          <div
            className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-1"
            role="tablist"
            aria-label="Mode d’import"
            data-testid="import-mode-tabs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={importMode === "csv"}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                importMode === "csv"
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
              data-testid="import-mode-csv"
              onClick={() => setImportMode("csv")}
            >
              <FileUp className="h-3.5 w-3.5" />
              Fichier CSV
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importMode === "wallet"}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                importMode === "wallet"
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
              data-testid="import-mode-wallet"
              onClick={() => setImportMode("wallet")}
            >
              <Wallet className="h-3.5 w-3.5" />
              Wallet blockchain
            </button>
          </div>
        )}

        {phase !== "success" && importMode === "csv" && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Importez un export broker/exchange ou le modèle Patrimo. Les actifs
            manquants sont créés automatiquement. Les{" "}
            <strong className="font-medium text-[var(--foreground)]">
              doublons
            </strong>{" "}
            sont ignorés si vous ré-importez le même fichier.
          </p>
        )}

        {phase !== "success" && importMode === "wallet" && (
          <div className="space-y-3" data-testid="import-wallet-form">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Choisissez la blockchain, l’adresse publique, puis synchronisez.
              <strong className="font-medium text-[var(--foreground)]">
                {" "}
                EVM (Ethereum, Polygon, Base…)
              </strong>{" "}
              → Zerion ·{" "}
              <strong className="font-medium text-[var(--foreground)]">
                Solana
              </strong>{" "}
              → Helius · Monero → solde local + CoinGecko.
            </p>
            <form className="space-y-3" onSubmit={submitWalletPlatform}>
              <Field label="Blockchain">
                <select
                  className="input w-full"
                  value={walletPresetKey}
                  onChange={(e) => {
                    const key = e.target.value;
                    setWalletPresetKey(key);
                    setWalletResult(null);
                    const cap = getChainSyncCapability(key);
                    if (cap?.provider === "zerion") {
                      setWalletApiKey(
                        cap.defaultApiKey || DEFAULT_ZERION_API_KEY
                      );
                    }
                  }}
                  data-testid="import-wallet-chain"
                >
                  {chainPresets.map((p) => {
                    const cap = getChainSyncCapability(p.key);
                    return (
                      <option key={p.key} value={p.key}>
                        {p.name}
                        {cap
                          ? cap.provider === "zerion"
                            ? " · Zerion"
                            : cap.provider === "helius-solana"
                              ? " · Helius"
                              : " · synchro"
                          : " · API manquante"}
                      </option>
                    );
                  })}
                </select>
              </Field>
              <Field
                label={
                  selectedChainCap?.provider === "monero-manual"
                    ? "Adresse (optionnel)"
                    : "Adresse wallet"
                }
              >
                <input
                  className="input w-full font-mono text-sm"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder={
                    selectedChainCap?.addressHint || "Adresse publique"
                  }
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="import-wallet-address"
                />
              </Field>

              {selectedChainCap?.provider === "zerion" && (
                <Field label="Clé API Zerion">
                  <input
                    className="input w-full font-mono text-sm"
                    value={walletApiKey}
                    onChange={(e) => setWalletApiKey(e.target.value)}
                    placeholder="zk_…"
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="import-wallet-api-key"
                  />
                </Field>
              )}

              {selectedChainCap?.provider === "monero-manual" && (
                <Field label="Solde XMR">
                  <input
                    className="input w-full font-mono text-sm"
                    value={walletMoneroAmount}
                    onChange={(e) => setWalletMoneroAmount(e.target.value)}
                    placeholder="ex. 12.5"
                    inputMode="decimal"
                    data-testid="import-wallet-monero-amount"
                  />
                </Field>
              )}

              {selectedChainCap?.provider === "zerion" && (
                <p
                  className="text-[11px] leading-relaxed text-[var(--muted-foreground)]"
                  data-testid="import-wallet-zerion-help"
                >
                  {ZERION_HELP_MESSAGE}
                </p>
              )}

              {!selectedChainCap && selectedChainPreset && (
                <div
                  className="rounded-lg border border-amber-400/70 bg-amber-50 px-3 py-2.5 dark:border-amber-700 dark:bg-amber-950/50"
                  data-testid="import-wallet-missing-api"
                  role="status"
                >
                  <p className="text-[11px] font-semibold text-amber-950 dark:text-amber-50">
                    {missingApiStatusMessage()}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                    {selectedChainPreset.name} : aucune intégration API dans le
                    code. La plateforme sera enregistrée avec l’adresse ; vous
                    pourrez ajouter des transactions manuellement ou
                    resynchroniser plus tard si une API est branchée.
                  </p>
                </div>
              )}
              {selectedChainCap && (
                <div
                  className="rounded-lg border border-emerald-400/60 bg-emerald-50 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/40"
                  data-testid="import-wallet-api-ready"
                  role="status"
                >
                  <p className="text-[11px] font-semibold text-emerald-950 dark:text-emerald-50">
                    {availableApiStatusMessage()}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-900/90 dark:text-emerald-100/90">
                    {describeChainSyncFeatures(selectedChainCap)}
                  </p>
                </div>
              )}

              {walletResult && (
                <div
                  className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2.5"
                  data-testid="import-wallet-result"
                >
                  <p className="text-sm font-medium">
                    {walletResult.platformName}{" "}
                    <span className="text-[11px] font-normal text-[var(--muted-foreground)]">
                      enregistrée
                    </span>
                  </p>
                  {walletResult.notice && (
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {walletResult.notice}
                    </p>
                  )}
                  {walletResult.snapshot && (
                    <p className="text-[12px] tabular-nums">
                      Valeur estimée on-chain :{" "}
                      <strong>
                        {walletResult.snapshot.totalValueUsd != null
                          ? new Intl.NumberFormat("fr-FR", {
                              style: "currency",
                              currency: "USD",
                              maximumFractionDigits: 2,
                            }).format(walletResult.snapshot.totalValueUsd)
                          : "—"}
                      </strong>
                      {" · "}
                      {(walletResult.snapshot.native ? 1 : 0) +
                        walletResult.snapshot.tokens.length}{" "}
                      actif(s)
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeAll}
                >
                  Fermer
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={walletPending}
                  data-testid="import-wallet-submit"
                >
                  {walletPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Enregistrement…
                    </>
                  ) : selectedChainCap ? (
                    "Enregistrer et synchroniser"
                  ) : (
                    "Enregistrer sans synchro"
                  )}
                </Button>
              </div>
            </form>
          </div>
        )}

        {importMode === "csv" &&
          (loadingPreview || committing || progress.active) &&
          phase !== "success" && (
            <ImportProgressBar progress={progress} />
          )}

        {/* ── Succès ─────────────────────────────────────────────────── */}
        {importMode === "csv" && phase === "success" && successSummary && (
          <div className="space-y-4" data-testid="import-success">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                <Check className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-100">
                  Import réussi
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-200/70">
                  {successSummary.fileName}
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Transactions importées
                </p>
                <p
                  className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--foreground)]"
                  data-testid="import-success-created"
                >
                  {successSummary.created}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Nouvelles positions / actifs
                </p>
                <p
                  className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--foreground)]"
                  data-testid="import-success-assets"
                >
                  {successSummary.assetsCreated}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Montant total détecté
                </p>
                <p
                  className="mt-0.5 text-xl font-semibold tabular-nums text-teal-300"
                  data-testid="import-success-amount"
                >
                  {successSummary.totalAmountLabel}
                </p>
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  Estimation sur les lignes sélectionnées (aperçu)
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Doublons ignorés
                </p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--foreground)]">
                  {successSummary.duplicates}
                </p>
                {successSummary.errors > 0 && (
                  <p className="mt-1 text-[10px] text-amber-400">
                    {successSummary.errors} ligne(s) en erreur
                  </p>
                )}
              </div>
            </div>

            {successSummary.platformsCreated.length > 0 && (
              <div
                className="space-y-2 rounded-xl border border-teal-500/25 bg-teal-500/5 p-3"
                data-testid="import-new-platforms"
              >
                <p className="text-xs font-semibold text-teal-900 dark:text-teal-100">
                  Nouvelles plateformes créées automatiquement (
                  {successSummary.platformsCreated.length})
                </p>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Affinez le logo maintenant ou plus tard dans Mes plateformes.
                </p>
                <ul className="space-y-2">
                  {successSummary.platformsCreated.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <PlatformLogo
                          src={p.logoDraft || p.logoUrl}
                          name={p.name}
                          size={28}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {p.name}
                          </p>
                          <span className="rounded-full bg-teal-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-teal-800 dark:text-teal-200">
                            Nouvelle
                          </span>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          className="input min-w-0 flex-1 text-xs"
                          placeholder="URL logo (https://…)"
                          value={p.logoDraft ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSuccessSummary((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    platformsCreated: prev.platformsCreated.map(
                                      (x) =>
                                        x.id === p.id
                                          ? { ...x, logoDraft: v }
                                          : x
                                    ),
                                  }
                                : prev
                            );
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={p.saving}
                          onClick={async () => {
                            const url = (p.logoDraft || "").trim();
                            if (url && !/^https?:\/\//i.test(url)) {
                              toast.error("URL logo invalide");
                              return;
                            }
                            setSuccessSummary((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    platformsCreated: prev.platformsCreated.map(
                                      (x) =>
                                        x.id === p.id
                                          ? { ...x, saving: true }
                                          : x
                                    ),
                                  }
                                : prev
                            );
                            try {
                              await fetchJson("/api/platforms", {
                                method: "PUT",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  id: p.id,
                                  logoUrl: url || null,
                                }),
                              });
                              toast.success(`Logo « ${p.name} » enregistré`);
                              setSuccessSummary((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      platformsCreated:
                                        prev.platformsCreated.map((x) =>
                                          x.id === p.id
                                            ? {
                                                ...x,
                                                logoUrl: url || null,
                                                saving: false,
                                              }
                                            : x
                                        ),
                                    }
                                  : prev
                              );
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Échec logo"
                              );
                              setSuccessSummary((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      platformsCreated:
                                        prev.platformsCreated.map((x) =>
                                          x.id === p.id
                                            ? { ...x, saving: false }
                                            : x
                                        ),
                                    }
                                  : prev
                              );
                            }
                          }}
                        >
                          Sauver
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={closeAll}
                data-testid="import-success-close"
              >
                Fermer
              </Button>
              <Button
                type="button"
                onClick={goToJournal}
                data-testid="import-success-journal"
              >
                Voir les positions
              </Button>
            </div>
          </div>
        )}

        {importMode === "csv" && phase !== "success" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Format">
                <select
                  className="input"
                  value={formatId}
                  onChange={(e) =>
                    setFormatId(e.target.value as ImportFormatId | "auto")
                  }
                >
                  <option value="auto">Auto-détection (recommandé)</option>
                  {IMPORT_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatId === "auto"
                    ? "Détecte Crypto.com, Nexo, Coinbase, Binance, Revolut, AscendEX, Fortuneo, IBKR, Trade Republic, Boursorama, Patrimo — sinon mapping dynamique."
                    : IMPORT_FORMATS.find((f) => f.id === formatId)
                        ?.description}
                </p>
                {preview?.needsFormatConfirm &&
                  (preview.ambiguousFormats?.length ?? 0) > 1 &&
                  formatId === "auto" && (
                    <div
                      className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-950 dark:text-amber-50"
                      data-testid="import-format-ambiguous"
                    >
                      <p className="font-semibold">
                        Format ambigu — choisissez la plateforme d’export
                      </p>
                      <p className="mt-0.5 opacity-90">
                        Plusieurs modèles correspondent (
                        {preview.ambiguousFormats!
                          .map((a) => a.label)
                          .join(", ")}
                        ). Sélectionnez le format exact ci-dessus puis
                        relancez l’analyse.
                      </p>
                    </div>
                  )}
                {preview && !preview.needsFormatConfirm && preview.formatLabel && (
                  <p
                    className="mt-1.5 text-[11px] text-teal-800 dark:text-teal-200"
                    data-testid="import-detected-format"
                  >
                    Détecté : {preview.formatLabel}
                    {preview.confidence
                      ? ` · confiance ${preview.confidence}`
                      : ""}
                  </p>
                )}
              </Field>
              <Field label="Plateforme par défaut">
                <PlatformCombobox
                  value={platformLabel}
                  allowCustom={false}
                  showCreateOption
                  placeholder="Destination si colonne plateforme absente…"
                  options={platformOptions}
                  onValueChange={setPlatformLabel}
                  onSelect={(sel) => {
                    if ("create" in sel && sel.create) {
                      onRequestCreatePlatform?.(sel.prefill);
                      return;
                    }
                    if ("custom" in sel && sel.custom) return;
                    if ("value" in sel) {
                      if (
                        sel.isCatalog ||
                        String(sel.value).startsWith("catalog:")
                      ) {
                        void onSelectCatalogPlatform?.(sel);
                        setPlatformLabel(sel.label);
                        return;
                      }
                      setPlatformId(sel.value);
                      setPlatformLabel(sel.label);
                    }
                  }}
                />
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  {platformsEmpty
                    ? "Aucune plateforme — créez-en une via « ＋ Autre »."
                    : "Si le CSV a une colonne plateforme, les noms inconnus sont créés automatiquement."}
                </p>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]">
                <FileUp className="h-4 w-4" />
                <span>{fileName || "Choisir un fichier CSV…"}</span>
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) =>
                    void handleFile(e.target.files?.[0] || null)
                  }
                />
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open("/api/import/template", "_blank");
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger le modèle
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void runPreview()}
                disabled={loadingPreview || !csvText}
                data-testid="import-analyze"
              >
                {loadingPreview ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Analyser
              </Button>
            </div>

            {preview && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {preview.totalRows} ligne(s) · format{" "}
                    <strong className="text-foreground">
                      {preview.formatLabel}
                    </strong>
                    {preview.detectedFormatId
                      ? ` (détecté : ${preview.detectedFormatId})`
                      : ""}{" "}
                    · séparateur «{" "}
                    {preview.delimiter === "\t" ? "tab" : preview.delimiter} » ·
                    colonnes mappées :{" "}
                    {Object.keys(preview.columnMap || {}).length}
                    {preview.confidence
                      ? ` · confiance ${preview.confidence}`
                      : ""}
                    {preview.truncated
                      ? ` · aperçu ${preview.previewLimit ?? 500}/${preview.totalRows}`
                      : ""}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setShowMapper((v) => !v)}
                      data-testid="import-toggle-mapper"
                    >
                      {showMapper
                        ? "Masquer le mapping"
                        : "Ajuster le mapping colonnes"}
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => selectAllValid(true)}
                    >
                      Tout sélectionner
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => selectAllValid(false)}
                    >
                      Tout désélectionner
                    </button>
                  </div>
                </div>

                {/* Mapping + aperçu 5 lignes brutes */}
                {showMapper && preview.headers?.length > 0 && (
                  <div
                    className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
                    data-testid="import-column-mapper"
                  >
                    <div>
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                        Associez chaque champ à une colonne du CSV
                        {preview.needsManualMapping
                          ? " — détection incomplète ou format inconnu"
                          : ""}
                        .
                      </p>
                      {!mappingReady && (
                        <p
                          className="mt-1 text-[11px] font-medium text-red-400"
                          data-testid="import-mapping-missing"
                        >
                          Colonnes obligatoires manquantes :{" "}
                          {missingRoles
                            .map(
                              (r) =>
                                MAPPABLE_ROLES.find((x) => x.id === r)?.label ||
                                r
                            )
                            .join(", ")}
                        </p>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {MAPPABLE_ROLES.filter((r) => r.id !== "ignore").map(
                        (role) => {
                          const currentHeader =
                            Object.entries(manualMap).find(
                              ([, v]) => v === role.id
                            )?.[0] || "";
                          const isMissing =
                            role.required &&
                            missingRoles.includes(role.id);
                          return (
                            <label
                              key={role.id}
                              className="flex flex-col gap-0.5 text-[11px]"
                            >
                              <span
                                className={cn(
                                  "font-medium",
                                  isMissing
                                    ? "text-red-400"
                                    : "text-slate-600 dark:text-slate-300"
                                )}
                              >
                                {role.label}
                                {role.required ? " *" : ""}
                              </span>
                              <select
                                className={cn(
                                  "input py-1 text-xs",
                                  isMissing && "ring-1 ring-red-500/50"
                                )}
                                value={currentHeader}
                                data-testid={`import-map-${role.id}`}
                                onChange={(e) => {
                                  const header = e.target.value;
                                  setManualMap((prev) => {
                                    const next = { ...prev };
                                    for (const [h, r] of Object.entries(
                                      next
                                    )) {
                                      if (r === role.id) delete next[h];
                                    }
                                    if (header) next[header] = role.id;
                                    return next;
                                  });
                                }}
                              >
                                <option value="">— non mappé —</option>
                                {preview.headers.map((h) => (
                                  <option key={h} value={h}>
                                    {h}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        }
                      )}
                    </div>

                    {/* 5 premières lignes brutes */}
                    {sampleRaw.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                          Aperçu brut (5 premières lignes)
                        </p>
                        <div className="max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-slate-950/40">
                          <table className="w-full text-left text-[10px]">
                            <thead className="sticky top-0 bg-slate-900/90 text-slate-400">
                              <tr>
                                {preview.headers.map((h) => (
                                  <th
                                    key={h}
                                    className="whitespace-nowrap px-2 py-1.5 font-medium"
                                  >
                                    <span className="block max-w-[8rem] truncate">
                                      {h}
                                    </span>
                                    {manualMap[h] && (
                                      <span className="mt-0.5 block text-[9px] font-normal text-teal-400/90">
                                        →{" "}
                                        {MAPPABLE_ROLES.find(
                                          (r) => r.id === manualMap[h]
                                        )?.label || manualMap[h]}
                                      </span>
                                    )}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sampleRaw.map((cells, i) => (
                                <tr
                                  key={i}
                                  className="border-t border-[var(--border)]/60"
                                >
                                  {cells.map((c, j) => (
                                    <td
                                      key={j}
                                      className="max-w-[8rem] truncate px-2 py-1 tabular-nums text-slate-300"
                                      title={c}
                                    >
                                      {c || "—"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={applyManualMapping}
                        disabled={!mappingReady}
                        data-testid="import-apply-mapping"
                      >
                        Appliquer &amp; ré-analyser
                      </Button>
                      {!mappingReady && (
                        <span className="self-center text-[11px] text-red-400">
                          Mapping incomplet — confirmation bloquée
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {phase === "preview" && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span>
                        Prévisualisation · {rows.length} ligne(s) chargée(s)
                        {preview.truncated
                          ? ` (échantillon / ${preview.totalRows} total)`
                          : ""}
                      </span>
                      <label className="flex items-center gap-1.5">
                        Lignes / page
                        <select
                          className="input !h-7 !w-auto !py-0 text-[11px]"
                          value={pageSize}
                          onChange={(e) => {
                            setPageSize(
                              Number(e.target.value) as PreviewPageSize
                            );
                            setPageIndex(0);
                          }}
                          data-testid="import-preview-page-size"
                        >
                          {PREVIEW_PAGE_SIZES.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="max-h-80 overflow-auto rounded-xl border border-[var(--border)]">
                      <table className="table-fluid text-left text-xs">
                        <thead className="table-head sticky top-0 text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="px-2 py-2">✓</th>
                            <th className="px-2 py-2">L.</th>
                            <th className="px-2 py-2">Statut</th>
                            <th className="px-2 py-2">Date</th>
                            <th className="px-2 py-2">Type</th>
                            <th className="px-2 py-2">Actif</th>
                            <th className="px-2 py-2 text-right">Qté</th>
                            <th className="px-2 py-2 text-right">Prix</th>
                            <th className="px-2 py-2 text-right">Montant</th>
                            <th className="px-2 py-2">Messages</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((r) => (
                            <tr
                              key={r.line}
                              className={cn(
                                "border-t border-[var(--border)]",
                                r.status === "error" && "bg-red-500/5",
                                r.status === "warning" && "bg-amber-500/5"
                              )}
                            >
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={r.selected}
                                  disabled={r.status === "error"}
                                  onChange={() => toggleRow(r.line)}
                                />
                              </td>
                              <td className="px-2 py-1.5 tabular-nums">
                                {r.line}
                              </td>
                              <td className="px-2 py-1.5">
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                                    r.status === "ok" &&
                                      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                                    r.status === "warning" &&
                                      "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                                    r.status === "error" &&
                                      "bg-red-500/15 text-red-700 dark:text-red-300"
                                  )}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5">
                                {r.occurredAt?.replace("T", " ") || "—"}
                              </td>
                              <td className="px-2 py-1.5">
                                {r.type
                                  ? TRANSACTION_TYPES[
                                      r.type as keyof typeof TRANSACTION_TYPES
                                    ] || r.type
                                  : "—"}
                              </td>
                              <td className="px-2 py-1.5">
                                {r.name || "—"}
                                {r.ticker ? (
                                  <span className="ml-1 text-slate-400">
                                    {r.ticker}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {r.quantity != null
                                  ? formatQuantity(r.quantity)
                                  : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {r.unitPrice
                                  ? formatCurrency(r.unitPrice, r.currency)
                                  : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {r.cashAmount
                                  ? formatCurrency(r.cashAmount, r.currency)
                                  : "—"}
                              </td>
                              <td className="max-w-[200px] px-2 py-1.5 text-[10px] text-slate-500">
                                {[...r.errors, ...r.warnings].join(" · ") ||
                                  "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span>
                        Page {pageIndex + 1} / {pageCount} · {pageRows.length}{" "}
                        ligne(s) affichée(s)
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="!h-7 !px-1.5"
                          disabled={pageIndex <= 0}
                          onClick={() =>
                            setPageIndex((p) => Math.max(0, p - 1))
                          }
                          aria-label="Page précédente"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="!h-7 !px-1.5"
                          disabled={pageIndex >= pageCount - 1}
                          onClick={() =>
                            setPageIndex((p) =>
                              Math.min(pageCount - 1, p + 1)
                            )
                          }
                          aria-label="Page suivante"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {preview.truncated ? (
                      <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
                        Aperçu paginé (échantillon serveur). L’import analysera
                        le{" "}
                        <strong className="text-[var(--foreground)]">
                          fichier complet
                        </strong>{" "}
                        (~{importableCount} ligne(s) valide(s) /{" "}
                        {preview.totalRows}).
                      </p>
                    ) : null}

                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={closeAll}
                      >
                        Annuler
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void runAnalyzeAndMaybeCommit()}
                        disabled={
                          committing ||
                          importableCount === 0 ||
                          !platformId ||
                          !mappingReady
                        }
                        data-testid="import-commit"
                        title={
                          !mappingReady
                            ? "Complétez le mapping des colonnes obligatoires"
                            : undefined
                        }
                      >
                        {committing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {preview.truncated
                          ? `Vérifier & importer (~${importableCount})`
                          : `Vérifier & importer ${importableCount}`}
                      </Button>
                    </div>
                  </>
                )}

                {phase === "suspects" && (
                  <div className="space-y-3" data-testid="import-suspects">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--foreground)]">
                      <p className="font-semibold text-amber-900 dark:text-amber-100">
                        Suspicions de doublons ({suspects.length})
                      </p>
                      <p className="mt-0.5 text-[var(--muted-foreground)]">
                        Même actif / qty / prix, horodatage proche (±5 min). Les
                        doublons <em>stricts</em> (
                        {analyzeInfo?.strictCount ?? 0}) sont déjà ignorés.
                        Cochez « Ajouter » uniquement si la ligne CSV est une{" "}
                        <strong>vraie</strong> opération distincte.
                      </p>
                      {analyzeInfo && (
                        <p className="mt-1 tabular-nums text-[var(--muted-foreground)]">
                          Prêtes à créer : {analyzeInfo.toCreateCount} ·
                          stricts auto : {analyzeInfo.strictCount} · suspects :{" "}
                          {analyzeInfo.suspectCount}
                        </p>
                      )}
                    </div>

                    <div className="max-h-96 space-y-3 overflow-y-auto pr-0.5">
                      {suspects.map((s) => (
                        <div
                          key={s.line}
                          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold">
                              Ligne CSV {s.line}
                              <span className="ml-2 font-normal text-[var(--muted-foreground)]">
                                Δ {Math.round(s.deltaMs / 1000)} s
                              </span>
                            </span>
                            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium">
                              <input
                                type="checkbox"
                                checked={Boolean(acceptSuspect[s.line])}
                                onChange={(e) =>
                                  setAcceptSuspect((prev) => ({
                                    ...prev,
                                    [s.line]: e.target.checked,
                                  }))
                                }
                                data-testid={`import-suspect-accept-${s.line}`}
                              />
                              Ajouter malgré tout
                            </label>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-2.5 py-2 text-[11px]">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                                En base
                              </div>
                              <p className="font-medium">
                                {s.existing.type} ·{" "}
                                {s.existing.ticker || "—"}
                              </p>
                              <p className="tabular-nums text-[var(--muted-foreground)]">
                                {formatDate(s.existing.occurredAt)}{" "}
                                {new Date(
                                  s.existing.occurredAt
                                ).toLocaleTimeString("fr-FR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </p>
                              <p className="tabular-nums">
                                Qté{" "}
                                {s.existing.quantity != null
                                  ? formatQuantity(s.existing.quantity)
                                  : "—"}{" "}
                                · Prix{" "}
                                {s.existing.unitPrice != null
                                  ? formatCurrency(
                                      s.existing.unitPrice,
                                      s.existing.currency
                                    )
                                  : "—"}
                              </p>
                            </div>
                            <div className="rounded-lg border border-teal-500/25 bg-teal-500/5 px-2.5 py-2 text-[11px]">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-200">
                                Fichier CSV
                              </div>
                              <p className="font-medium">
                                {s.draft.type || "—"} ·{" "}
                                {s.draft.ticker || "—"}
                              </p>
                              <p className="tabular-nums text-[var(--muted-foreground)]">
                                {s.draft.occurredAt
                                  ? `${formatDate(s.draft.occurredAt)} ${new Date(
                                      s.draft.occurredAt
                                    ).toLocaleTimeString("fr-FR", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}`
                                  : "—"}
                              </p>
                              <p className="tabular-nums">
                                Qté{" "}
                                {s.draft.quantity != null
                                  ? formatQuantity(s.draft.quantity)
                                  : "—"}{" "}
                                · Prix{" "}
                                {s.draft.unitPrice != null
                                  ? formatCurrency(
                                      s.draft.unitPrice,
                                      s.draft.currency
                                    )
                                  : "—"}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setPhase("preview")}
                        disabled={committing}
                      >
                        Retour aperçu
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          const accepted = Object.entries(acceptSuspect)
                            .filter(([, v]) => v)
                            .map(([k]) => Number(k));
                          void finishCommit(accepted);
                        }}
                        disabled={committing}
                        data-testid="import-commit-suspects"
                      >
                        {committing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Finaliser l’import
                        {Object.values(acceptSuspect).filter(Boolean).length >
                        0
                          ? ` (+${Object.values(acceptSuspect).filter(Boolean).length} suspect(s))`
                          : " (ignorer les suspects)"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

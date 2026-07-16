"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileUp, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PlatformCombobox } from "@/components/ui/platform-combobox";
import { IMPORT_FORMATS, type ImportFormatId, type ColumnRole } from "@/app/lib/import/presets";
import type { ImportDraftRow } from "@/app/lib/import/map-rows";
import { decodeCsvBuffer } from "@/app/lib/import/normalize";
import {
  loadSavedColumnMap,
  saveColumnMap,
} from "@/app/lib/import/mapping-store";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import { cn, formatCurrency } from "@/app/lib/utils";
import { fetchJson } from "@/app/lib/api-client";

type PlatformOption = {
  value: string;
  label: string;
  subtitle?: string;
  logoUrl?: string | null;
};

const MAPPABLE_ROLES: { id: ColumnRole; label: string; required?: boolean }[] = [
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
  { id: "notes", label: "Notes" },
  { id: "description", label: "Description" },
  { id: "ignore", label: "— Ignorer —" },
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
  rows: ImportDraftRow[];
  totalRows: number;
  truncated: boolean;
  stats: { ok: number; warning: number; error: number };
  warnings?: string[];
};

export function ImportCsvModal({
  open,
  onClose,
  platformOptions,
  platformsEmpty,
  defaultPlatformId,
  defaultPlatformLabel,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  platformOptions: PlatformOption[];
  platformsEmpty: boolean;
  defaultPlatformId?: string;
  defaultPlatformLabel?: string;
  onImported: () => void;
}) {
  const [formatId, setFormatId] = useState<ImportFormatId | "auto">("auto");
  const [platformId, setPlatformId] = useState(defaultPlatformId || "");
  const [platformLabel, setPlatformLabel] = useState(defaultPlatformLabel || "");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [rows, setRows] = useState<ImportDraftRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  /** Mapping manuel (header → rôle) */
  const [manualMap, setManualMap] = useState<Record<string, ColumnRole>>({});
  const [showMapper, setShowMapper] = useState(false);

  const selectedCount = useMemo(
    () => rows.filter((r) => r.selected).length,
    [rows]
  );

  if (!open) return null;

  function reset() {
    setFileName("");
    setCsvText("");
    setPreview(null);
    setRows([]);
    setManualMap({});
    setShowMapper(false);
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    // Décodage UTF-8 / latin1 robuste
    const buf = await file.arrayBuffer();
    const text = decodeCsvBuffer(buf);
    setCsvText(text);
    setPreview(null);
    setRows([]);
    setManualMap({});
    setShowMapper(false);
  }

  async function runPreview(overrideMap?: Record<string, ColumnRole>) {
    if (!csvText.trim()) {
      toast.error("Choisissez un fichier CSV");
      return;
    }
    setLoadingPreview(true);
    try {
      // Mapping mémorisé pour ce jeu d'en-têtes (si pas d'override)
      const columnMap = overrideMap || (Object.keys(manualMap).length ? manualMap : null);
      if (!columnMap) {
        // headers unknown until preview — try load after first response
      }

      const data = await fetchJson<PreviewResponse>("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText,
          formatId,
          columnMap: columnMap || undefined,
        }),
      });

      // Si pas de map manuelle, tenter le store local
      if (!columnMap && data.headers?.length) {
        const saved = loadSavedColumnMap(data.headers);
        if (saved && Object.keys(saved).length > 0) {
          const retry = await fetchJson<PreviewResponse>("/api/import/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              csvText,
              formatId,
              columnMap: saved,
            }),
          });
          setPreview(retry);
          setRows(retry.rows);
          setManualMap(saved as Record<string, ColumnRole>);
          setShowMapper(Boolean(retry.needsManualMapping));
          toast.success(
            `Mapping mémorisé réutilisé · ${retry.stats.ok} OK · ${retry.stats.error} erreur(s)`
          );
          return;
        }
      }

      setPreview(data);
      setRows(data.rows);
      setManualMap((data.columnMap || {}) as Record<string, ColumnRole>);
      setShowMapper(Boolean(data.needsManualMapping) || data.confidence === "low");
      toast.success(
        `Analyse : ${data.stats.ok} OK · ${data.stats.warning} avert. · ${data.stats.error} erreur(s)` +
          (data.confidence ? ` · confiance ${data.confidence}` : "")
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'analyse");
    } finally {
      setLoadingPreview(false);
    }
  }

  function applyManualMapping() {
    if (!preview?.headers?.length) return;
    saveColumnMap(preview.headers, manualMap, fileName || "import");
    toast.message("Mapping enregistré pour les prochains imports similaires");
    void runPreview(manualMap);
  }

  async function runCommit() {
    if (!platformId) {
      toast.error("Sélectionnez une plateforme de destination");
      return;
    }
    if (selectedCount === 0) {
      toast.error("Aucune ligne sélectionnée");
      return;
    }
    setCommitting(true);
    try {
      const result = await fetchJson<{
        created: number;
        skipped: number;
        assetsCreated: number;
        errors: Array<{ line: number; message: string }>;
      }>("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId, rows }),
      });
      toast.success(
        `Import terminé : ${result.created} transaction(s), ${result.assetsCreated} actif(s) créé(s)`
      );
      if (result.errors.length > 0) {
        toast.message(
          `${result.errors.length} ligne(s) en échec (ex. L${result.errors[0].line} : ${result.errors[0].message})`
        );
      }
      onImported();
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'import");
    } finally {
      setCommitting(false);
    }
  }

  function toggleRow(line: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.line === line && r.status !== "error" ? { ...r, selected: !r.selected } : r
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

  return (
    <Modal title="Importer des transactions (CSV)" onClose={onClose} wide>
      <div className="space-y-4" data-testid="import-csv-modal">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Importez un export broker/exchange ou le modèle Patrimo. Les actifs manquants sont
          créés automatiquement. Les montants historiques acceptent un cash temporairement
          négatif pour coller à l&apos;ordre chronologique.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Format">
            <select
              className="input"
              value={formatId}
              onChange={(e) => setFormatId(e.target.value as ImportFormatId | "auto")}
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
                ? "Détecte Fortuneo, IBKR, Trade Republic, Revolut, Coinbase, Binance, Boursorama, Patrimo — sinon mapping dynamique."
                : IMPORT_FORMATS.find((f) => f.id === formatId)?.description}
            </p>
          </Field>
          <Field label="Plateforme de destination">
            <PlatformCombobox
              value={platformLabel}
              allowCustom={false}
              placeholder="Choisir une plateforme…"
              options={platformOptions}
              onValueChange={setPlatformLabel}
              onSelect={(sel) => {
                if ("custom" in sel && sel.custom) return;
                if ("value" in sel) {
                  setPlatformId(sel.value);
                  setPlatformLabel(sel.label);
                }
              }}
            />
            {platformsEmpty && (
              <p className="mt-1 text-xs text-amber-600">
                Créez d&apos;abord une plateforme (onglet Plateformes).
              </p>
            )}
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
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
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
                <strong className="text-foreground">{preview.formatLabel}</strong>
                {preview.detectedFormatId ? ` (détecté : ${preview.detectedFormatId})` : ""} ·
                séparateur « {preview.delimiter === "\t" ? "tab" : preview.delimiter} » · colonnes
                mappées : {Object.keys(preview.columnMap || {}).length}
                {preview.confidence ? ` · confiance ${preview.confidence}` : ""}
                {preview.truncated && " · aperçu limité à 500"}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="underline"
                  onClick={() => setShowMapper((v) => !v)}
                >
                  {showMapper ? "Masquer le mapping" : "Ajuster le mapping colonnes"}
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

            {showMapper && preview.headers?.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                  Associez chaque champ obligatoire à une colonne du CSV
                  {preview.needsManualMapping
                    ? " — détection incomplète ou format inconnu"
                    : ""}
                  .
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MAPPABLE_ROLES.filter((r) => r.id !== "ignore").map((role) => {
                    const currentHeader =
                      Object.entries(manualMap).find(([, v]) => v === role.id)?.[0] ||
                      "";
                    return (
                      <label
                        key={role.id}
                        className="flex flex-col gap-0.5 text-[11px]"
                      >
                        <span className="font-medium text-slate-600 dark:text-slate-300">
                          {role.label}
                          {role.required ? " *" : ""}
                        </span>
                        <select
                          className="input py-1 text-xs"
                          value={currentHeader}
                          onChange={(e) => {
                            const header = e.target.value;
                            setManualMap((prev) => {
                              const next = { ...prev };
                              // retirer l'ancien assignement de ce rôle
                              for (const [h, r] of Object.entries(next)) {
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
                  })}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button type="button" size="sm" onClick={applyManualMapping}>
                    Appliquer &amp; ré-analyser
                  </Button>
                </div>
              </div>
            )}

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
                  {rows.map((r) => (
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
                      <td className="px-2 py-1.5 tabular-nums">{r.line}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                            r.status === "ok" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                            r.status === "warning" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                            r.status === "error" && "bg-red-500/15 text-red-700 dark:text-red-300"
                          )}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {r.occurredAt?.replace("T", " ") || "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.type
                          ? TRANSACTION_TYPES[r.type as keyof typeof TRANSACTION_TYPES] ||
                            r.type
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.name || "—"}
                        {r.ticker ? (
                          <span className="ml-1 text-slate-400">{r.ticker}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.quantity ?? "—"}
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
                      <td className="px-2 py-1.5 text-[10px] text-slate-500 max-w-[200px]">
                        {[...r.errors, ...r.warnings].join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button
                type="button"
                onClick={runCommit}
                disabled={committing || selectedCount === 0 || !platformId}
              >
                {committing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Importer {selectedCount} ligne(s)
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

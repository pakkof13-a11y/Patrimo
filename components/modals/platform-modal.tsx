"use client";

import { useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import {
  PlatformCombobox,
  type PlatformComboboxOption,
} from "@/components/ui/platform-combobox";
import { PLATFORM_TYPES } from "@/app/lib/constants";
import {
  ASSURANCE_VIE_SUBTYPES,
  PLATFORM_PRESETS,
} from "@/app/lib/platforms/presets";
import type { PlatformForm } from "@/app/lib/schemas";
import { cn } from "@/app/lib/utils";

/** Types in form (no hardware wallet), sorted A–Z by French label */
const PLATFORM_TYPE_OPTIONS = Object.entries(PLATFORM_TYPES)
  .filter(([key]) => key !== "PORTEFEUILLE_HARDWARE")
  .sort(([, a], [, b]) => a.localeCompare(b, "fr", { sensitivity: "base" }));

const AV_SUBTYPE_RANK = new Map(
  ASSURANCE_VIE_SUBTYPES.map((s, i) => [s, i] as const)
);

export function PlatformModal({
  open,
  form,
  comboLabel,
  onComboLabelChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: UseFormReturn<PlatformForm>;
  comboLabel: string;
  onComboLabelChange: (label: string) => void;
  onClose: () => void;
  onSubmit: (values: PlatformForm) => void;
}) {
  const [logoManualOpen, setLogoManualOpen] = useState(false);
  const [selectionKind, setSelectionKind] = useState<"none" | "preset" | "custom">(
    "none"
  );

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: "",
      type: "" as PlatformForm["type"],
      subtype: null,
      logoKey: "",
      logoUrl: "",
      walletAddress: "",
    });
    onComboLabelChange("");
    setLogoManualOpen(false);
    setSelectionKind("none");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when open flips true
  }, [open]);

  const selectedType = (form.watch("type") as string) || "";
  const name = form.watch("name") || "";
  const logoUrl = form.watch("logoUrl") || "";
  const typeReady =
    Boolean(selectedType) &&
    selectedType in PLATFORM_TYPES &&
    selectedType !== "PORTEFEUILLE_HARDWARE";
  const showWallet = selectedType === "BLOCKCHAIN";
  const typeLabel =
    PLATFORM_TYPES[selectedType as keyof typeof PLATFORM_TYPES] || selectedType;

  const platformOptions: PlatformComboboxOption[] = useMemo(() => {
    if (!typeReady) return [];
    const filtered = PLATFORM_PRESETS.filter((p) => p.type === selectedType).slice();

    if (selectedType === "ASSURANCE_VIE") {
      filtered.sort((a, b) => {
        const ra =
          AV_SUBTYPE_RANK.get(
            a.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]
          ) ?? 99;
        const rb =
          AV_SUBTYPE_RANK.get(
            b.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]
          ) ?? 99;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
      });
    } else {
      filtered.sort((a, b) =>
        a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
      );
    }

    return filtered.map((p) => ({
      value: p.key,
      label: p.name,
      subtitle: p.subtype
        ? p.subtype
        : PLATFORM_TYPES[p.type as keyof typeof PLATFORM_TYPES] || p.type,
      logoUrl: p.logoUrl,
      preset: p,
    }));
  }, [typeReady, selectedType]);

  function clearPlatformFields() {
    form.setValue("name", "");
    form.setValue("logoKey", "");
    form.setValue("logoUrl", "");
    form.setValue("walletAddress", "");
    form.setValue("subtype", null);
    onComboLabelChange("");
    setSelectionKind("none");
    setLogoManualOpen(false);
  }

  function handleTypeChange(type: string) {
    form.setValue("type", type as PlatformForm["type"]);
    clearPlatformFields();
  }

  function applySelection(
    sel:
      | { custom: true; label: string }
      | {
          value: string;
          label: string;
          preset?: (typeof PLATFORM_PRESETS)[number];
        }
  ) {
    if ("custom" in sel && sel.custom) {
      form.setValue("name", sel.label);
      form.setValue("logoKey", "");
      form.setValue("logoUrl", "");
      form.setValue("subtype", null);
      onComboLabelChange(sel.label);
      setSelectionKind("custom");
      setLogoManualOpen(false);
      return;
    }
    if ("preset" in sel && sel.preset) {
      const p = sel.preset;
      form.setValue("name", p.name);
      form.setValue("type", selectedType as PlatformForm["type"]);
      form.setValue("logoKey", p.key);
      form.setValue("logoUrl", p.logoUrl);
      if (selectedType === "BLOCKCHAIN") {
        form.setValue("subtype", p.subtype || null);
      } else if (selectedType === "ASSURANCE_VIE") {
        form.setValue("subtype", p.subtype || null);
        form.setValue("walletAddress", "");
      } else {
        form.setValue("walletAddress", "");
        form.setValue("subtype", p.subtype || null);
      }
      onComboLabelChange(p.name);
      setSelectionKind("preset");
      setLogoManualOpen(false);
      return;
    }
    if ("label" in sel) {
      form.setValue("name", sel.label);
      onComboLabelChange(sel.label);
      setSelectionKind("custom");
    }
  }

  function handleClose() {
    onClose();
    onComboLabelChange("");
  }

  const previewName = name.trim() || comboLabel.trim();
  const canSubmit = typeReady && previewName.length > 0;

  if (!open) return null;

  return (
    <Modal
      title="Nouvelle plateforme"
      panelClassName="w-[min(28rem,calc(100vw-2rem))] sm:w-[min(32rem,calc(100vw-2rem))]"
      bodyScroll={false}
      onClose={handleClose}
    >
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          if (!typeReady || !values.name?.trim()) return;
          onSubmit(
            values.type === "BLOCKCHAIN"
              ? values
              : { ...values, walletAddress: "" }
          );
        })}
        data-testid="platform-create-form"
      >
        <p className="text-meta -mt-1">
          1. Type · 2. Preset ou nom libre · 3. Confirmer
        </p>

        {/* 1. Type */}
        <Field label="Type de plateforme">
          <select
            className="input"
            value={selectedType}
            onChange={(e) => handleTypeChange(e.target.value)}
            data-testid="platform-type-select"
          >
            <option value="">— Choisir un type —</option>
            {PLATFORM_TYPE_OPTIONS.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        {/* 2. Nom / preset */}
        <Field
          label={
            typeReady
              ? `Plateforme · ${typeLabel}`
              : "Plateforme"
          }
        >
          <div className={cn(!typeReady && "pointer-events-none opacity-50")}>
            <PlatformCombobox
              value={comboLabel || form.watch("name") || ""}
              allowCustom
              disabled={!typeReady}
              options={platformOptions}
              placeholder={
                typeReady
                  ? "Rechercher un preset ou saisir un nom…"
                  : "Choisissez d’abord un type"
              }
              onValueChange={(text) => {
                if (!typeReady) return;
                onComboLabelChange(text);
                form.setValue("name", text);
                // Saisie libre en cours tant qu’aucun preset n’est re-sélectionné
                if (selectionKind === "preset") {
                  const match = platformOptions.some(
                    (o) => o.label.toLowerCase() === text.trim().toLowerCase()
                  );
                  if (!match) {
                    setSelectionKind(text.trim() ? "custom" : "none");
                    form.setValue("logoKey", "");
                    if (!logoManualOpen) form.setValue("logoUrl", "");
                  }
                } else if (text.trim()) {
                  setSelectionKind("custom");
                } else {
                  setSelectionKind("none");
                }
              }}
              onSelect={(sel) => {
                if (!typeReady) return;
                applySelection(sel as never);
              }}
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted-foreground)]">
            {typeReady
              ? "Choisissez une suggestion catalogue, ou validez un nom libre pour une plateforme personnalisée."
              : "Le type active la recherche de presets adaptés."}
          </p>
        </Field>

        {/* 3. Prévisualisation / état sélection */}
        {typeReady && previewName && (
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5",
              selectionKind === "preset"
                ? "border-teal-700/30 bg-teal-700/5"
                : "border-[var(--border)] bg-[var(--muted)]/25"
            )}
            data-testid="platform-selection-preview"
          >
            <PlatformLogo
              src={logoUrl || null}
              name={previewName}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                {previewName}
              </p>
              <p className="text-meta mt-0.5">
                {selectionKind === "preset" ? (
                  <span className="font-medium text-teal-800 dark:text-teal-200">
                    Preset catalogue
                  </span>
                ) : (
                  <span className="font-medium">Plateforme personnalisée</span>
                )}
                <span className="mx-1 opacity-40">·</span>
                {typeLabel}
              </p>
            </div>
          </div>
        )}

        {/* Logo : détection + correction optionnelle */}
        {typeReady && previewName && (
          <div className="rounded-lg border border-[var(--border)] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-medium text-[var(--foreground)]">
                  Logo
                </p>
                <p className="text-meta">
                  {selectionKind === "preset" && logoUrl
                    ? "Logo du preset (modifiable si incorrect)"
                    : "Optionnel — correction manuelle si besoin"}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-800 hover:underline dark:text-teal-200"
                onClick={() => setLogoManualOpen((v) => !v)}
                data-testid="platform-logo-manual-toggle"
              >
                {logoManualOpen
                  ? "Masquer l’URL"
                  : "Modifier le logo manuellement"}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    logoManualOpen && "rotate-180"
                  )}
                />
              </button>
            </div>
            {logoManualOpen && (
              <div className="mt-2.5">
                <label className="text-[11px] text-[var(--muted-foreground)]">
                  URL du logo
                  <input
                    className="input mt-1 w-full text-sm"
                    placeholder="https://… (laisser vide pour l’auto-détection)"
                    {...form.register("logoUrl")}
                    data-testid="platform-logo-url"
                  />
                </label>
                <p className="text-meta mt-1">
                  Utilisez ce champ uniquement pour corriger un logo mal détecté.
                </p>
              </div>
            )}
          </div>
        )}

        {showWallet && (
          <Field label="Adresse wallet">
            <input
              className="input font-mono text-sm"
              placeholder="0x… ou adresse publique"
              {...form.register("walletAddress")}
            />
          </Field>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" variant="outline" onClick={handleClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            data-testid="platform-create-submit"
          >
            Créer la plateforme
          </Button>
        </div>
      </form>
    </Modal>
  );
}

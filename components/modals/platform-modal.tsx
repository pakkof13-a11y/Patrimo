"use client";

import { useEffect, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
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
  // Reset flow each time the modal opens: type empty → platform locked
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when open flips true
  }, [open]);

  const selectedType = (form.watch("type") as string) || "";
  const typeReady =
    Boolean(selectedType) &&
    selectedType in PLATFORM_TYPES &&
    selectedType !== "PORTEFEUILLE_HARDWARE";
  const showWallet = selectedType === "BLOCKCHAIN";

  const platformOptions: PlatformComboboxOption[] = useMemo(() => {
    if (!typeReady) return [];
    const filtered = PLATFORM_PRESETS.filter((p) => p.type === selectedType).slice();

    // Assurance-vie : ordre des sous-catégories, puis A–Z dans chaque groupe
    // Autres types : A–Z sur le nom
    if (selectedType === "ASSURANCE_VIE") {
      filtered.sort((a, b) => {
        const ra = AV_SUBTYPE_RANK.get(a.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]) ?? 99;
        const rb = AV_SUBTYPE_RANK.get(b.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]) ?? 99;
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
  }

  function handleTypeChange(type: string) {
    form.setValue("type", type as PlatformForm["type"]);
    clearPlatformFields();
  }

  function applySelection(
    sel:
      | { custom: true; label: string }
      | { value: string; label: string; preset?: (typeof PLATFORM_PRESETS)[number] }
  ) {
    if ("custom" in sel && sel.custom) {
      form.setValue("name", sel.label);
      form.setValue("logoKey", "");
      form.setValue("logoUrl", "");
      onComboLabelChange(sel.label);
      return;
    }
    if ("preset" in sel && sel.preset) {
      const p = sel.preset;
      form.setValue("name", p.name);
      form.setValue("type", selectedType as PlatformForm["type"]);
      form.setValue("subtype", p.subtype || null);
      form.setValue("logoKey", p.key);
      form.setValue("logoUrl", p.logoUrl);
      if (selectedType !== "BLOCKCHAIN") {
        form.setValue("walletAddress", "");
        form.setValue("subtype", null);
      }
      onComboLabelChange(p.name);
      return;
    }
    if ("label" in sel) {
      form.setValue("name", sel.label);
      onComboLabelChange(sel.label);
    }
  }

  function handleClose() {
    onClose();
    onComboLabelChange("");
  }

  if (!open) return null;

  return (
    <Modal
      title="Nouvelle plateforme"
      panelClassName="w-[min(66vw,calc(100vw-2rem))] max-w-[66vw]"
      bodyScroll={false}
      onClose={handleClose}
    >
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit((values) => {
          if (!typeReady) return;
          onSubmit(
            values.type === "BLOCKCHAIN"
              ? values
              : { ...values, walletAddress: "" }
          );
        })}
      >
        {/* 1. Type first */}
        <Field label="Type">
          <select
            className="input"
            value={selectedType}
            onChange={(e) => handleTypeChange(e.target.value)}
            data-testid="platform-type-select"
          >
            <option value="">— Sélectionner un type —</option>
            {PLATFORM_TYPE_OPTIONS.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        {/* 2. Platform — locked until type is chosen */}
        <Field label="Plateforme (presets + saisie libre)">
          <div className={cn(!typeReady && "pointer-events-none opacity-50")}>
            <PlatformCombobox
              value={comboLabel || form.watch("name") || ""}
              allowCustom
              disabled={!typeReady}
              options={platformOptions}
              placeholder={
                typeReady
                  ? "Rechercher un preset ou saisir un nom libre…"
                  : "Choisissez d’abord un type ci-dessus"
              }
              onValueChange={(text) => {
                if (!typeReady) return;
                onComboLabelChange(text);
                form.setValue("name", text);
              }}
              onSelect={(sel) => {
                if (!typeReady) return;
                applySelection(sel as never);
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            {typeReady
              ? "Suggestions filtrées par type, triées A–Z. Saisie libre toujours possible."
              : "Sélectionnez un type pour activer ce champ."}
          </p>
        </Field>

        <Field label="URL du logo (optionnel)">
          <input className="input" placeholder="https://…" {...form.register("logoUrl")} />
        </Field>
        {showWallet && (
          <Field label="Adresse wallet (blockchains)">
            <input
              className="input"
              placeholder="0x… ou adresse publique"
              {...form.register("walletAddress")}
            />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={!typeReady}>
            Créer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

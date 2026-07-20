"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PlatformLogo } from "./platform-logo";
import { cn } from "@/app/lib/utils";
import {
  PLATFORM_PRESETS,
  filterPresets,
  primaryType,
  type PlatformPreset,
} from "@/app/lib/platforms/presets";
import { PLATFORM_TYPES } from "@/app/lib/constants";
import { filterPlatformPickOptions } from "@/app/lib/platforms/catalog-options";

export type PlatformComboboxOption = {
  value: string;
  /** Ligne 1 */
  label: string;
  /** Ligne 2 — catégorie principale */
  categoryLabel?: string;
  /** Ligne 3 — sous-titre descriptif optionnel */
  description?: string;
  /** @deprecated = categoryLabel */
  subtitle?: string;
  logoUrl?: string | null;
  /** Badge « Nouvelle » après création contextuelle */
  isNew?: boolean;
  /** Suggestion catalogue (pas de badge visible « Catalogue ») */
  isCatalog?: boolean;
  /** Extra payload (preset or platform id meta) */
  preset?: PlatformPreset;
};

export type PlatformComboboxSelect =
  | PlatformComboboxOption
  | { custom: true; label: string }
  | { create: true; prefill?: string };

type Props = {
  /** Controlled text / selected label shown in the input */
  value: string;
  onValueChange: (text: string) => void;
  /** When user picks a suggestion (or confirms custom / create) */
  onSelect: (option: PlatformComboboxSelect) => void;
  /** Predefined options (user platforms or presets). Defaults to PLATFORM_PRESETS. */
  options?: PlatformComboboxOption[];
  /** Allow free-text value not in the list (legacy) */
  allowCustom?: boolean;
  /**
   * Affiche une option fixe « ＋ Autre / Nouvelle plateforme » en bas.
   * Prioritaire sur allowCustom pour le flux transaction.
   */
  showCreateOption?: boolean;
  createOptionLabel?: string;
  placeholder?: string;
  className?: string;
  /** data-testid for e2e */
  testId?: string;
  disabled?: boolean;
};

const CREATE_VALUE = "__create_new_platform__";

function presetsAsOptions(): PlatformComboboxOption[] {
  return PLATFORM_PRESETS.map((p) => {
    const cat =
      PLATFORM_TYPES[primaryType(p) as keyof typeof PLATFORM_TYPES] ||
      primaryType(p);
    return {
      value: p.key,
      label: p.name,
      categoryLabel: cat,
      description: p.subtype || undefined,
      subtitle: cat,
      logoUrl: p.logoUrl,
      isCatalog: true,
      preset: p,
    };
  });
}

export function PlatformCombobox({
  value,
  onValueChange,
  onSelect,
  options,
  allowCustom = true,
  showCreateOption = false,
  createOptionLabel = "＋ Autre / Nouvelle plateforme",
  placeholder = "Rechercher ou saisir…",
  className,
  testId,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const source = options ?? presetsAsOptions();

  const filtered = useMemo(() => {
    // Prefix strict sur le libellé affiché uniquement (pas category / key / alias).
    const ordered = options
      ? [...source]
      : [...source].sort((a, b) =>
          a.label.localeCompare(b.label, "fr", { sensitivity: "base" })
        );
    return filterPlatformPickOptions(ordered, value);
  }, [source, value, options]);

  const showCustom =
    !showCreateOption &&
    allowCustom &&
    value.trim().length > 0 &&
    !filtered.some((o) => o.label.toLowerCase() === value.trim().toLowerCase());

  const items: Array<
    | { kind: "option"; option: PlatformComboboxOption }
    | { kind: "custom"; label: string }
    | { kind: "create"; label: string }
  > = [
    ...filtered.map((option) => ({ kind: "option" as const, option })),
    ...(showCustom ? [{ kind: "custom" as const, label: value.trim() }] : []),
    ...(showCreateOption
      ? [{ kind: "create" as const, label: createOptionLabel }]
      : []),
  ];

  useEffect(() => {
    setHighlight(0);
  }, [value, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) {
      setCoords(null);
      return;
    }
    function update() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 12;
      const spaceAbove = r.top - 12;
      const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(
        320,
        Math.max(120, preferBelow ? spaceBelow : spaceAbove)
      );
      setCoords({
        top: preferBelow ? r.bottom + 4 : Math.max(8, r.top - 4 - maxHeight),
        left: r.left,
        width: r.width,
        maxHeight,
      });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  function pick(index: number) {
    const item = items[index];
    if (!item) return;
    if (item.kind === "create") {
      onSelect({ create: true, prefill: value.trim() || undefined });
      setOpen(false);
      return;
    }
    if (item.kind === "custom") {
      onSelect({ custom: true, label: item.label });
      onValueChange(item.label);
    } else {
      onSelect(item.option);
      onValueChange(item.option.label);
    }
    setOpen(false);
  }

  const list =
    open &&
    coords &&
    typeof document !== "undefined" &&
    createPortal(
      items.length > 0 ? (
        <ul
          ref={listRef}
          id="platform-combobox-listbox"
          className="z-[100] overflow-y-auto overscroll-contain rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
          role="listbox"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
          }}
        >
          {items.map((item, i) => {
            if (item.kind === "create") {
              return (
                <li
                  key={CREATE_VALUE}
                  role="option"
                  aria-selected={i === highlight}
                  data-testid="platform-combobox-create"
                  className={cn(
                    "cursor-pointer border-t border-[var(--border)] px-3 py-2.5 text-sm",
                    i === highlight
                      ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100"
                      : "hover:bg-[var(--muted)]"
                  )}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                >
                  <div className="font-medium text-teal-800 dark:text-teal-200">
                    {item.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                    Créer une plateforme à la volée
                  </div>
                </li>
              );
            }
            if (item.kind === "custom") {
              return (
                <li
                  key={`custom-${item.label}`}
                  role="option"
                  aria-selected={i === highlight}
                  className={cn(
                    "cursor-pointer border-t border-[var(--border)] px-3 py-2.5 text-sm",
                    i === highlight
                      ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100"
                      : "hover:bg-[var(--muted)]"
                  )}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Créer comme plateforme personnalisée
                  </div>
                  <div className="mt-0.5 font-medium">« {item.label} »</div>
                </li>
              );
            }
            const o = item.option;
            const categoryLine =
              o.categoryLabel ||
              (o.subtitle && !/^catalogue/i.test(o.subtitle)
                ? o.subtitle
                : undefined);
            const descLine = o.description;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm",
                  i === highlight
                    ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100"
                    : "hover:bg-[var(--muted)]"
                )}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                <PlatformLogo src={o.logoUrl} name={o.label} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="truncate font-medium">{o.label}</span>
                    {o.isNew && (
                      <span className="shrink-0 rounded-full bg-teal-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-teal-800 dark:text-teal-200">
                        Nouvelle
                      </span>
                    )}
                  </div>
                  {categoryLine ? (
                    <div className="truncate text-[11px] font-medium text-[var(--muted-foreground)]">
                      {categoryLine}
                    </div>
                  ) : null}
                  {descLine ? (
                    <div className="truncate text-[10px] text-[var(--muted-foreground)]/90">
                      {descLine}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className="z-[100] rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-zinc-500 shadow-xl"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: coords.width,
          }}
        >
          {showCreateOption
            ? "Aucune plateforme — choisissez « Autre » pour en créer une"
            : allowCustom && value.trim()
              ? "Aucune suggestion — Entrée pour valider le texte saisi"
              : "Aucune suggestion"}
        </div>
      ),
      document.body
    );

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        className="input w-full"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={testId}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? "platform-combobox-listbox" : undefined}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            setOpen(true);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(0, items.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (items[highlight]) pick(highlight);
            else if (showCreateOption) {
              onSelect({ create: true, prefill: value.trim() || undefined });
              setOpen(false);
            } else if (allowCustom && value.trim()) {
              onSelect({ custom: true, label: value.trim() });
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {list}
    </div>
  );
}

/** Convenience: filter presets by query (for external use). */
export function useFilteredPresets(query: string): PlatformPreset[] {
  return useMemo(() => filterPresets(query), [query]);
}

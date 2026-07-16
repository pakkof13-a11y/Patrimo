"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PlatformLogo } from "./platform-logo";
import { cn } from "@/app/lib/utils";
import {
  PLATFORM_PRESETS,
  filterPresets,
  type PlatformPreset,
} from "@/app/lib/platforms/presets";
import { PLATFORM_TYPES } from "@/app/lib/constants";

export type PlatformComboboxOption = {
  value: string;
  label: string;
  subtitle?: string;
  logoUrl?: string | null;
  /** Extra payload (preset or platform id meta) */
  preset?: PlatformPreset;
};

type Props = {
  /** Controlled text / selected label shown in the input */
  value: string;
  onValueChange: (text: string) => void;
  /** When user picks a suggestion (or confirms custom) */
  onSelect: (option: PlatformComboboxOption | { custom: true; label: string }) => void;
  /** Predefined options (user platforms or presets). Defaults to PLATFORM_PRESETS. */
  options?: PlatformComboboxOption[];
  /** Allow free-text value not in the list */
  allowCustom?: boolean;
  placeholder?: string;
  className?: string;
  /** data-testid for e2e */
  testId?: string;
  disabled?: boolean;
};

function presetsAsOptions(): PlatformComboboxOption[] {
  return PLATFORM_PRESETS.map((p) => ({
    value: p.key,
    label: p.name,
    subtitle: `${PLATFORM_TYPES[p.type] || p.type}${p.category ? ` · ${p.category}` : ""}`,
    logoUrl: p.logoUrl,
    preset: p,
  }));
}

export function PlatformCombobox({
  value,
  onValueChange,
  onSelect,
  options,
  allowCustom = true,
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
    const q = value.trim().toLowerCase();
    // Preserve caller order when `options` is provided (e.g. AV subtypes).
    // Default presets: A–Z by label.
    const ordered = options
      ? [...source]
      : [...source].sort((a, b) =>
          a.label.localeCompare(b.label, "fr", { sensitivity: "base" })
        );
    if (!q) return ordered.slice(0, 80);
    return ordered
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.subtitle || "").toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [source, value, options]);

  const showCustom =
    allowCustom &&
    value.trim().length > 0 &&
    !filtered.some((o) => o.label.toLowerCase() === value.trim().toLowerCase());

  const items: Array<
    | { kind: "option"; option: PlatformComboboxOption }
    | { kind: "custom"; label: string }
  > = [
    ...filtered.map((option) => ({ kind: "option" as const, option })),
    ...(showCustom ? [{ kind: "custom" as const, label: value.trim() }] : []),
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

  // Fixed positioning so the list scrolls independently of any modal overflow
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
      const maxHeight = Math.min(320, Math.max(120, preferBelow ? spaceBelow : spaceAbove));
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
  }, [open, value, items.length]);

  function pick(index: number) {
    const item = items[index];
    if (!item) return;
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
            if (item.kind === "custom") {
              return (
                <li
                  key={`custom-${item.label}`}
                  role="option"
                  aria-selected={i === highlight}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm",
                    i === highlight
                      ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  )}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                >
                  Utiliser « <span className="font-medium">{item.label}</span> » (personnalisé)
                </li>
              );
            }
            const o = item.option;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm",
                  i === highlight
                    ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                )}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                <PlatformLogo src={o.logoUrl} name={o.label} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{o.label}</div>
                  {o.subtitle && (
                    <div className="truncate text-[11px] text-zinc-500">{o.subtitle}</div>
                  )}
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
          Aucune suggestion
          {allowCustom && value.trim() ? " — Entrée pour valider le texte saisi" : ""}
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
            else if (allowCustom && value.trim()) {
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

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/app/lib/utils";

export type FilterChipOption = {
  value: string;
  label: string;
  /** Nombre de positions concernées — affiché à droite de l'option. */
  count?: number;
};

type MenuCoords = { top: number; left: number; width: number; maxHeight: number };

const MENU_WIDTH = 248;

/**
 * Puce de filtre du portefeuille.
 *
 * Sélection multiple, avec une convention volontairement simple : **rien de
 * coché = aucune restriction**. Décocher la dernière case rend donc la totalité
 * du portefeuille au lieu de vider le tableau — le contraire est la façon la
 * plus courante de se retrouver devant un écran vide sans comprendre pourquoi.
 * `emptyMeans="none"` inverse cette lecture pour la seule puce dont l'écran
 * traite déjà le vide comme un filtre à part entière (l'enveloppe).
 *
 * La puce ne connaît ni les enveloppes ni les devises : elle reçoit ses options
 * et rend une sélection. C'est l'écran qui décide de ce que la sélection filtre.
 */
export function FilterChip({
  label,
  options,
  selected,
  onChange,
  allLabel = "Tous",
  emptyMeans = "all",
  pluralNoun,
  singleSelect,
  shortcuts,
  testId,
  disabled,
}: {
  label: string;
  options: FilterChipOption[];
  /** Valeurs cochées. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Libellé quand la puce ne restreint rien. */
  allLabel?: string;
  /**
   * Ce que veut dire « aucune case cochée ». `"all"` — le cas ordinaire — ne
   * restreint rien. `"none"` est réservé à l'enveloppe, où l'écran affiche
   * réellement zéro position tant qu'aucune n'est choisie.
   */
  emptyMeans?: "all" | "none";
  /** Nom au pluriel pour le résumé « 3 devises ». */
  pluralNoun: string;
  /**
   * Une seule valeur à la fois : cliquer une option remplace la précédente.
   * Réservé aux filtres dont le traitement en aval est mono-valeur (la
   * plateforme, qui redécoupe les positions multi-dépositaires).
   */
  singleSelect?: boolean;
  /**
   * Raccourcis en pied de menu. Sans eux, un unique « Effacer ce filtre »
   * apparaît quand la puce restreint quelque chose. Les puces dont le vide a
   * un sens propre — l'enveloppe, où « rien de coché » veut dire « aucune
   * position » et non « toutes » — s'en servent pour nommer leurs deux pôles
   * au lieu de laisser croire qu'effacer élargit la sélection.
   */
  shortcuts?: { label: string; next: string[]; testId: string }[];
  testId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Position fixe recalculée à l'ouverture puis au scroll : le menu vit dans un
  // portail pour ne pas être rogné par le `overflow: hidden` de la carte.
  useLayoutEffect(() => {
    // Fermé : on laisse les dernières coordonnées en place plutôt que de les
    // remettre à zéro. Le menu n'est de toute façon pas monté, et l'effet
    // recalcule tout avant la peinture à la réouverture.
    if (!open) return;
    function update() {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const pad = 12;
      const spaceBelow = window.innerHeight - r.bottom - pad;
      const spaceAbove = r.top - pad;
      const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(360, Math.max(180, below ? spaceBelow : spaceAbove));
      const left = Math.max(
        pad,
        Math.min(r.left, window.innerWidth - MENU_WIDTH - pad)
      );
      setCoords({
        top: below ? r.bottom + gap : Math.max(pad, r.top - gap - maxHeight),
        left,
        width: MENU_WIDTH,
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
  }, [open, options.length]);

  /**
   * Restreint-elle vraiment ? Tout cocher ne filtre rien, et l'or de la puce
   * doit signaler « il manque des lignes à cause de moi » — pas « on m'a
   * touchée ».
   */
  const everything = options.length > 0 && selected.length === options.length;
  const restricting =
    emptyMeans === "none"
      ? !everything
      : selected.length > 0 && !everything;

  const summary =
    selected.length === 0
      ? emptyMeans === "none"
        ? "Aucune"
        : allLabel
      : everything
        ? allLabel
        : selected.length === 1
          ? (options.find((o) => o.value === selected[0])?.label ??
            selected[0]!)
          : `${selected.length} ${pluralNoun}`;

  function toggle(value: string) {
    if (singleSelect) {
      onChange(selected.includes(value) ? [] : [value]);
      setOpen(false);
      return;
    }
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  }

  const menu =
    open &&
    coords &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={menuRef}
        className="term-chip-menu z-[100] flex flex-col"
        role="listbox"
        aria-multiselectable={!singleSelect}
        aria-label={label}
        data-testid={`${testId}-menu`}
        style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          width: coords.width,
          maxHeight: coords.maxHeight,
        }}
      >
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {options.length === 0 && (
            <li className="text-meta px-[var(--space-2)] py-[var(--space-2)]">
              Aucune valeur à filtrer
            </li>
          )}
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className="term-chip-option"
                  data-testid={`${testId}-option-${o.value}`}
                  onClick={() => toggle(o.value)}
                >
                  <Check
                    className={cn(
                      "h-3 w-3 shrink-0",
                      checked
                        ? "text-[var(--primary-text)]"
                        : "text-transparent"
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate" title={o.label}>
                    {o.label}
                  </span>
                  {o.count != null && (
                    <span className="num shrink-0 text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                      {o.count}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {shortcuts ? (
          <div className="mt-[var(--space-1)] flex gap-[var(--space-1)] border-t border-[var(--border)] pt-[var(--space-2)]">
            {shortcuts.map((s) => (
              <button
                key={s.testId}
                type="button"
                className="term-chip-option justify-center text-[var(--foreground-faint)]"
                data-testid={s.testId}
                onClick={() => onChange(s.next)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          restricting && (
            <button
              type="button"
              className="term-chip-option mt-[var(--space-1)] justify-center border-t border-[var(--border)] pt-[var(--space-2)] text-[var(--foreground-faint)]"
              data-testid={`${testId}-clear`}
              onClick={() => onChange([])}
            >
              Effacer ce filtre
            </button>
          )
        )}
      </div>,
      document.body
    );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="term-chip"
        data-filtered={restricting ? "true" : "false"}
        data-testid={testId}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="term-chip-label">{label}</span>
        <span className="term-chip-value">{summary}</span>
        <ChevronDown
          className={cn("h-3 w-3 shrink-0 opacity-60", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {menu}
    </>
  );
}

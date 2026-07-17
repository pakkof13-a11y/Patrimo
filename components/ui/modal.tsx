"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/app/lib/utils";

/** Contextual dialogs: max 66 % of viewport width (not full shell / 95 %). */
const PANEL_WIDTH =
  "w-[min(66vw,calc(100vw-2rem))] max-w-[66vw]";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal accessible : focus trap, Escape, restore focus, scroll lock body.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  panelClassName,
  /** When true (default), body scrolls if content is long. Prefer false when a child has its own scroll (combobox list). */
  bodyScroll = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** Optional override for the dialog panel width/layout */
  panelClassName?: string;
  bodyScroll?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus first focusable or the panel itself
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);

      if (nodes.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          /* element may be unmounted */
        }
      }
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      data-testid="modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        // Clic fond = fermer (pas le panel)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          // Outer panel never scrolls — avoids double scrollbar with nested lists
          "card flex max-h-[90vh] min-w-0 flex-col overflow-hidden p-5 shadow-2xl outline-none",
          panelClassName ?? PANEL_WIDTH,
          wide && "shadow-2xl"
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="modal-panel"
      >
        {/* Sticky header: title + close — never scrolls with body */}
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h3 id={titleId} className="text-lg font-semibold leading-snug">
            {title}
          </h3>
          <button
            type="button"
            className="rounded-[var(--radius-md)] px-2 py-1 text-slate-400 transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            onClick={onClose}
            aria-label="Fermer la fenêtre"
            data-testid="modal-close"
          >
            ✕
          </button>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1",
            bodyScroll ? "overflow-y-auto overscroll-contain" : "overflow-visible"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export { PANEL_WIDTH as MODAL_PANEL_WIDTH };

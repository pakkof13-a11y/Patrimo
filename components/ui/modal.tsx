"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/app/lib/utils";

/** Contextual dialogs: max 66 % of viewport width (not full shell / 95 %). */
const PANEL_WIDTH =
  "w-[min(66vw,calc(100vw-2rem))] max-w-[66vw]";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Stack global des modales montées (ordre = profondeur).
 * Échap / focus trap ne s’appliquent qu’à la modale au sommet.
 */
const modalStack: symbol[] = [];
let scrollLockCount = 0;

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.tabIndex !== -1 &&
      el.getAttribute("aria-hidden") !== "true" &&
      el.offsetParent !== null
  );
}

/**
 * Modal accessible (WCAG) :
 * - focus trap (Tab / Shift+Tab)
 * - focus auto sur le 1er champ du corps (pas le bouton fermer)
 * - Échap ferme (uniquement la modale au premier plan)
 * - restore focus sur l’élément déclencheur
 * - scroll lock body (ref-count multi-modales)
 * - layer / suspended pour empiler import → création plateforme
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  panelClassName,
  /** When true (default), body scrolls if content is long. Prefer false when a child has its own scroll (combobox list). */
  bodyScroll = true,
  /** data-testid du panneau (défaut modal-panel) */
  testId = "modal-panel",
  /**
   * Profondeur visuelle (0 = base, 1 = au-dessus d’une autre modale).
   * z-index = 50 + layer * 20
   */
  layer = 0,
  /**
   * Modale en arrière-plan (suspendue) : non interactive, atténuée,
   * ne capture plus Échap / focus trap.
   */
  suspended = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  panelClassName?: string;
  bodyScroll?: boolean;
  testId?: string;
  layer?: number;
  suspended?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const stackIdRef = useRef(Symbol("modal"));

  const onCloseRef = useRef(onClose);
  const suspendedRef = useRef(suspended);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  // Stack + scroll lock + focus initial (une fois au mount)
  useEffect(() => {
    const id = stackIdRef.current;
    modalStack.push(id);

    previouslyFocused.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    scrollLockCount += 1;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const body = bodyRef.current;
    if (panel && !suspendedRef.current) {
      const prefer =
        body?.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])'
        ) ||
        body?.querySelector<HTMLElement>(FOCUSABLE) ||
        listFocusable(panel).find(
          (el) => el.getAttribute("data-testid") !== "modal-close"
        ) ||
        panel;
      requestAnimationFrame(() => {
        // Double rAF : laisse peindre la couche au-dessus d’une éventuelle modale parent
        requestAnimationFrame(() => {
          try {
            prefer.focus();
          } catch {
            panel.focus();
          }
        });
      });
    }

    function isTopModal() {
      return modalStack[modalStack.length - 1] === id;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (suspendedRef.current || !isTopModal()) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const nodes = listFocusable(panelRef.current);
      if (nodes.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (active && !panelRef.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

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
      const idx = modalStack.indexOf(id);
      if (idx >= 0) modalStack.splice(idx, 1);

      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.style.overflow = prevOverflow || "";
      }

      document.removeEventListener("keydown", onKeyDown, true);
      const prev = previouslyFocused.current;
      // Ne restaurer le focus que si on était la modale au sommet
      // (sinon la modale parent reprend le focus trap)
      if (
        modalStack.length === 0 &&
        prev &&
        typeof prev.focus === "function" &&
        document.contains(prev)
      ) {
        try {
          prev.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  // Quand on redevient la top-modale (après fermeture d’un enfant), refocus panel
  useEffect(() => {
    if (suspended) return;
    const id = stackIdRef.current;
    if (modalStack[modalStack.length - 1] !== id) return;
    const panel = panelRef.current;
    const body = bodyRef.current;
    if (!panel) return;
    const prefer =
      body?.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])'
      ) || panel;
    // Ne voler le focus que si le focus est hors de cette modale
    if (document.activeElement && panel.contains(document.activeElement)) {
      return;
    }
    requestAnimationFrame(() => {
      try {
        prefer.focus();
      } catch {
        /* ignore */
      }
    });
  }, [suspended]);

  const zClass =
    layer <= 0
      ? "z-50"
      : layer === 1
        ? "z-[70]"
        : "z-[90]";

  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center p-4",
        zClass,
        suspended
          ? "pointer-events-none bg-slate-950/40 backdrop-blur-[1px]"
          : "bg-slate-950/60 backdrop-blur-sm",
        suspended && "opacity-90"
      )}
      data-testid="modal-overlay"
      data-modal-layer={layer}
      data-modal-suspended={suspended ? "true" : "false"}
      role="presentation"
      aria-hidden={suspended ? true : undefined}
      onMouseDown={(e) => {
        if (suspended) return;
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "card flex max-h-[90vh] min-w-0 flex-col overflow-hidden p-5 shadow-2xl outline-none",
          "focus-visible:shadow-[var(--focus-ring)]",
          panelClassName ?? PANEL_WIDTH,
          wide && "shadow-2xl",
          suspended && "scale-[0.98] shadow-md"
        )}
        role="dialog"
        aria-modal={suspended ? undefined : "true"}
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid={testId}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h3 id={titleId} className="text-lg font-semibold leading-snug">
            {title}
          </h3>
          <button
            type="button"
            className="rounded-[var(--radius-md)] px-2 py-1 text-slate-400 transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-40"
            onClick={() => onCloseRef.current()}
            aria-label="Fermer la fenêtre (Échap)"
            data-testid="modal-close"
            disabled={suspended}
            tabIndex={suspended ? -1 : 0}
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
        <p id={descId} className="sr-only">
          {suspended
            ? "Dialogue en arrière-plan. Terminez d’abord la fenêtre au premier plan."
            : "Dialogue. Échap pour fermer. Tab pour naviguer dans le formulaire."}
        </p>
        <div
          ref={bodyRef}
          data-modal-body
          className={cn(
            "min-h-0 flex-1",
            bodyScroll
              ? "overflow-y-auto overscroll-contain"
              : "overflow-visible"
          )}
          // Inert-like : pas d’interaction pendant suspension
          inert={suspended ? true : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export { PANEL_WIDTH as MODAL_PANEL_WIDTH };

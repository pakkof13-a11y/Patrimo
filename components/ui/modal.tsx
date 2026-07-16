"use client";

import { cn } from "@/app/lib/utils";

/** Contextual dialogs: max 66 % of viewport width (not full shell / 95 %). */
const PANEL_WIDTH =
  "w-[min(66vw,calc(100vw-2rem))] max-w-[66vw]";

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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      data-testid="modal-overlay"
      role="presentation"
    >
      <div
        className={cn(
          // Outer panel never scrolls — avoids double scrollbar with nested lists
          "card flex max-h-[90vh] min-w-0 flex-col overflow-hidden p-5 shadow-2xl",
          panelClassName ?? PANEL_WIDTH,
          // `wide` kept for API compat; width is already capped at 66vw
          wide && "shadow-2xl"
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Sticky header: title + close — never scrolls with body */}
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800/40 hover:text-slate-100"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1",
            bodyScroll ? "overflow-y-auto" : "overflow-visible"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export { PANEL_WIDTH as MODAL_PANEL_WIDTH };

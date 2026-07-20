"use client";

import { Keyboard } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { KEYBOARD_SHORTCUTS } from "@/app/lib/ui/keyboard-shortcuts";

/**
 * Panneau d’aide des raccourcis clavier (?).
 */
export function ShortcutsHelpPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <Modal title="Raccourcis clavier" onClose={onClose} panelClassName="w-[min(24rem,calc(100vw-2rem))]">
      <div className="space-y-3" data-testid="shortcuts-help-panel">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--muted-foreground)]">
          <Keyboard className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" aria-hidden />
          Navigation clavier Patrimo — les raccourcis sont désactivés pendant la
          saisie dans un champ.
        </p>
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {KEYBOARD_SHORTCUTS.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[var(--foreground)]">
                  {s.label}
                </p>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {s.description}
                </p>
              </div>
              <kbd
                className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--muted)] px-2 py-1 font-mono text-[11px] font-semibold tabular-nums text-[var(--foreground)] shadow-sm"
                aria-label={`Touche ${s.keys}`}
              >
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Appuyez sur <kbd className="rounded border border-[var(--border)] px-1 font-mono text-[10px]">Échap</kbd> pour fermer ce panneau.
        </p>
      </div>
    </Modal>
  );
}

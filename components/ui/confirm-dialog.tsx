"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/**
 * Confirmation branded, léger (un seul pas) — remplace `window.confirm()`
 * pour les actions à faible surface (une ligne, réversible en la ressaisissant),
 * par opposition au pattern double-confirmation (checkbox + mot-clé) réservé
 * aux suppressions en cascade (voir platforms-tab.tsx : suppression d'une
 * plateforme entraîne celle de toutes ses transactions/actifs liés).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Supprimer",
  cancelLabel = "Annuler",
  danger = true,
  onConfirm,
  onCancel,
  testId,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  if (!open) return null;
  return (
    <Modal title={title} onClose={onCancel} panelClassName="max-w-sm">
      <div className="space-y-3" data-testid={testId}>
        <p className="text-sm text-[var(--foreground)]">{message}</p>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            data-testid={testId ? `${testId}-cancel` : undefined}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "default"}
            size="sm"
            onClick={onConfirm}
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

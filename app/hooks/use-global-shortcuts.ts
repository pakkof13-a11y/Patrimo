"use client";

import { useEffect } from "react";
import {
  isModalOpen,
  isTypingTarget,
} from "@/app/lib/ui/keyboard-shortcuts";

export type GlobalShortcutHandlers = {
  /** / ou Ctrl+K */
  onSearch: () => void;
  /** n */
  onNewTransaction: () => void;
  /** ? */
  onHelp: () => void;
  /** Échap quand aucune modal dialog (palette / panneaux) */
  onEscape?: () => void;
  /** Désactiver les raccourcis (ex. pendant login) */
  enabled?: boolean;
};

/**
 * Raccourcis globaux document-level.
 * Ignorés dans les champs de saisie et quand une modal est déjà ouverte
 * (sauf Échap, géré par la modal elle-même).
 */
export function useGlobalShortcuts(handlers: GlobalShortcutHandlers) {
  const { onSearch, onNewTransaction, onHelp, onEscape, enabled = true } =
    handlers;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd+K toujours (même depuis un input pour palette)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onSearch();
        return;
      }

      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const typing = isTypingTarget(e.target);
      const modal = isModalOpen();

      // Échap hors modal → fermer palette / aide
      if (e.key === "Escape" && !modal) {
        onEscape?.();
        return;
      }

      if (typing || modal) return;

      if (e.key === "/") {
        e.preventDefault();
        onSearch();
        return;
      }

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        onNewTransaction();
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        onHelp();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onSearch, onNewTransaction, onHelp, onEscape]);
}

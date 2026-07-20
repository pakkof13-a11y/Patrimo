/**
 * Raccourcis clavier globaux Patrimo.
 * Voir docs/keyboard-shortcuts.md
 */

export type ShortcutId =
  | "search"
  | "newTransaction"
  | "escape"
  | "help"
  | "commandPalette";

export type ShortcutDef = {
  id: ShortcutId;
  /** Affichage UI (ex. « / », « n », « ? ») */
  keys: string;
  label: string;
  description: string;
};

/** Liste canonique pour l’aide et les tooltips. */
export const KEYBOARD_SHORTCUTS: ShortcutDef[] = [
  {
    id: "search",
    keys: "/",
    label: "Recherche",
    description: "Ouvrir la recherche globale / palette de commandes",
  },
  {
    id: "commandPalette",
    keys: "Ctrl+K",
    label: "Palette",
    description: "Ouvrir la palette de commandes (alias)",
  },
  {
    id: "newTransaction",
    keys: "n",
    label: "Nouvelle transaction",
    description: "Ouvrir le formulaire d’ajout de transaction",
  },
  {
    id: "escape",
    keys: "Échap",
    label: "Fermer",
    description: "Fermer la modal, le panneau ou la palette ouverte",
  },
  {
    id: "help",
    keys: "?",
    label: "Aide raccourcis",
    description: "Afficher la liste des raccourcis clavier",
  },
];

/** True si le focus est dans un champ de saisie (ne pas intercepter les lettres). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // role=combobox / textbox custom
  const role = target.getAttribute("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") {
    // combobox input only — if it's the input itself
    if (tag === "INPUT" || target.getAttribute("contenteditable") === "true") {
      return true;
    }
  }
  return false;
}

/** Une modal dialog (aria-modal) est ouverte. */
export function isModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector('[role="dialog"][aria-modal="true"]')
  );
}

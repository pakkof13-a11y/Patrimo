/**
 * Préférences UI isolées (SSR-safe) — localStorage / sessionStorage, hors calculs financiers.
 */

const PREFIX = "patrimo.ui.";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function canUseSession(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function loadUiPref<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    // Migration : ancienne clé « expanded secondaires » → visible strip
    if (key === "kpiStripVisible") {
      const modern = localStorage.getItem(PREFIX + "kpiStripVisible");
      if (modern != null) return JSON.parse(modern) as T;
      // Ancien défaut compact = secondaires fermés, mais primaires visibles
      // → on considère la barre visible par défaut
      return fallback;
    }
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveUiPref<T>(key: string, value: T): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function loadSessionPref<T>(key: string, fallback: T): T {
  if (!canUseSession()) return fallback;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveSessionPref<T>(key: string, value: T): void {
  if (!canUseSession()) return;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

export function clearSessionPref(key: string): void {
  if (!canUseSession()) return;
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export type SavedHoldingsView = {
  id: string;
  name: string;
  envelope: string;
  accountType: string;
  search: string;
  /** colonnes visibles */
  visibility?: Record<string, boolean>;
  pageSize?: number;
  createdAt: string;
};

const VIEWS_KEY = "holdingsViews";

export function loadSavedViews(): SavedHoldingsView[] {
  return loadUiPref<SavedHoldingsView[]>(VIEWS_KEY, []);
}

export function saveSavedViews(views: SavedHoldingsView[]): void {
  saveUiPref(VIEWS_KEY, views);
}

/** @deprecated préférer KPI_VISIBLE_KEY — gardé pour migration lecture */
export const KPI_EXPANDED_KEY = "positionsKpiExpanded";

/**
 * Affichage des 8 indicateurs (tous onglets).
 * true = visibles (défaut) · false = masqués.
 * Migre l’ancienne clé positionsKpiExpanded (true = secondaires ouverts).
 */
export const KPI_VISIBLE_KEY = "kpiStripVisible";

/** Regroupement Positions : "none" | "assetCategory" */
export const HOLDINGS_GROUP_BY_KEY = "holdingsGroupBy";

/**
 * État replié des groupes de catégories, par enveloppe.
 * Forme : { [envelopeOrAll]: { [categoryCode]: true si replié } }
 */
export const HOLDINGS_GROUP_COLLAPSED_KEY = "holdingsGroupCollapsed";

/** Masquage permanent de l'aide (localStorage) — ne réapparaît plus. */
export const ONBOARDING_DISMISS_KEY = "onboardingDismissed";

/**
 * Si true (défaut) : « Afficher à chaque démarrage ».
 * Masquer l'aide → dismiss session uniquement (réapparaît au prochain login / nouvel onglet).
 * Si false : Masquer l'aide → dismiss permanent (localStorage).
 */
export const ONBOARDING_SHOW_EVERY_START_KEY = "onboardingShowEveryStart";

/**
 * Masquage pour la session navigateur courante (sessionStorage).
 * Suffixe v2 : invalide d'anciens flags de test / bug qui masquaient au F5.
 */
export const ONBOARDING_SESSION_DISMISS_KEY = "onboardingSessionDismissed_v2";

/**
 * Lit l'état d'affichage de l'aide — à appeler uniquement côté client
 * (après mount), jamais dans un useState initializer (hydratation SSR).
 *
 * - Case « Afficher à chaque démarrage » cochée (défaut) :
 *   dismissed = false au chargement (F5 réaffiche toujours).
 *   Masquer = mémoire React seulement pour la visite.
 * - Case décochée + Masquer : permanent via localStorage.
 */
export function loadOnboardingDismissState(): {
  dismissed: boolean;
  showEveryStart: boolean;
} {
  if (typeof window === "undefined") {
    return { dismissed: false, showEveryStart: true };
  }

  const showEveryStart = loadUiPref(ONBOARDING_SHOW_EVERY_START_KEY, true);
  const permanent = loadUiPref(ONBOARDING_DISMISS_KEY, false);

  // Toujours purger l'ancien masquage session (survivait au F5)
  clearSessionPref(ONBOARDING_SESSION_DISMISS_KEY);

  if (showEveryStart) {
    // Case cochée : ignorer / purger un ancien dismiss permanent
    if (permanent) {
      saveUiPref(ONBOARDING_DISMISS_KEY, false);
    }
    return { dismissed: false, showEveryStart: true };
  }

  return { dismissed: Boolean(permanent), showEveryStart: false };
}
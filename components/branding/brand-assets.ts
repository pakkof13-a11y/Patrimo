/**
 * Chemins normalisés des assets marque Aurea (public/branding/).
 * Sources d’origine (Downloads) conservées hors repo avec leurs noms exacts.
 */
export const BRAND = {
  name: "Aurea",
  /** Sous-titre court (header, méta). */
  tagline: "Suivi de patrimoine",
  /**
   * Descripteur affiché sous le nom dans le header du terminal.
   *
   * Distinct de `tagline` (qui reste la formulation grand public employée
   * par les métadonnées et l'écran de connexion) : celui-ci annonce la
   * nature de l'outil à un utilisateur déjà connecté.
   */
  terminal: "Terminal patrimonial",
  /**
   * Slogan marketing — login, onboarding, hero.
   * Source unique : ne pas hardcoder ailleurs.
   */
  slogan: "Wealth. Unified",
  logo: {
    dark: "/branding/logo-dark.png",
    light: "/branding/logo-light.png",
  },
  banner: {
    dark: "/branding/banner-dark.png",
    light: "/branding/banner-light.png",
  },
  /**
   * Fonds full-bleed (liquid glass) — light/dark via next-themes.
   * Sources : « fond white mode.png » / « fond dark mode.png » (Downloads).
   */
  background: {
    dark: "/branding/bg-dark.png",
    light: "/branding/bg-light.png",
  },
} as const;

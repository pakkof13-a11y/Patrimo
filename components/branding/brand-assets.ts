/**
 * Chemins normalisés des assets marque Aurea (public/branding/).
 * Sources d’origine (Downloads) conservées hors repo avec leurs noms exacts.
 */
export const BRAND = {
  name: "Aurea",
  /** Sous-titre court (header, méta). */
  tagline: "Suivi de patrimoine",
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
  background: {
    dark: "/branding/bg-dark.png",
    light: "/branding/bg-light.jpg",
  },
} as const;

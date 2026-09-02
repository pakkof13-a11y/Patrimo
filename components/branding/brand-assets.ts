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
  /**
   * Sigle doré sur fond transparent — un seul asset pour les deux thèmes.
   * L'ancien logo était un PNG posé sur un aplat plein (un par thème) ; celui-ci
   * n'a pas ce problème, `dark`/`light` restent distincts dans le type pour ne
   * pas rouvrir `BrandLogo` si un jour les deux redivergent.
   */
  logo: {
    dark: "/branding/logo-gold.png",
    light: "/branding/logo-gold.png",
  },
  /**
   * Fond de l'écran de connexion — image unique, indépendante du thème.
   * Cet écran ne suit plus next-themes (voir `app/login/page.tsx`) : la scène
   * reste la même quel que soit le réglage clair/sombre de l'application.
   */
  background: {
    login: "/branding/login-bg.png",
  },
} as const;

/**
 * Palette d'allocation — stable par classe d'actifs.
 *
 * Deux règles, toutes deux structurelles :
 *
 * 1. **La couleur suit la classe, jamais son rang.** Colorier par taille (ce
 *    que faisait la version précédente) fait changer une classe de couleur dès
 *    qu'elle passe devant une autre : impossible de reconnaître l'immobilier
 *    d'un coup d'œil d'une session à l'autre, et le camembert et la mosaïque
 *    pouvaient afficher deux couleurs différentes pour la même classe.
 *
 * 2. **Aucun vert ni rouge.** Ces deux teintes portent la performance
 *    (`--positive` / `--negative`) partout ailleurs dans l'app ; les réutiliser
 *    pour une catégorie ferait lire « en perte » une simple part de patrimoine.
 *    La palette reste donc dans les bleus, violets, cyans, ambres et ardoises.
 *
 * Les libellés sont ceux produits par `getAssetClassLabel` — c'est ce que
 * reçoivent les graphiques, aucune donnée n'est retransformée ici.
 */

/** Teintes catégorielles, volontairement sans vert ni rouge. */
const CATEGORICAL = [
  "#2563eb", // bleu
  "#7c3aed", // violet
  "#d97706", // ambre
  "#0891b2", // cyan
  "#4f46e5", // indigo
  "#64748b", // ardoise
  "#a16207", // bronze
  "#475569", // ardoise foncée
] as const;

/**
 * Classes patrimoniales connues → teinte fixe. Reprend l'esprit des badges
 * `ASSET_CLASS_COLORS` (bleu actions, ambre crypto, violet immobilier), à une
 * exception près : les liquidités passent de l'émeraude à l'ardoise, l'émeraude
 * étant réservée aux gains.
 */
const BY_CLASS_LABEL: Record<string, string> = {
  "Actions / ETF": "#2563eb",
  Cryptomonnaies: "#d97706",
  Immobilier: "#7c3aed",
  Obligations: "#0891b2",
  "Liquidités / Cash": "#64748b",
  Autre: "#94a3b8",
};

/**
 * Hachage stable d'un libellé vers la palette catégorielle — utilisé pour les
 * séries dont les noms sont saisis par l'utilisateur (plateformes), où aucune
 * table fixe n'est possible. Déterministe : la même plateforme garde sa
 * couleur d'une session à l'autre, indépendamment de son poids.
 */
export function stableColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORICAL[hash % CATEGORICAL.length]!;
}

/** Couleur d'une part d'allocation, stable et indépendante de sa taille. */
export function allocationColor(name: string): string {
  return BY_CLASS_LABEL[name] ?? stableColorFor(name);
}

/**
 * Encre lisible sur une teinte de la palette.
 *
 * Du blanc sur l'ambre ou le cyan tombe sous 3:1 — sous le seuil AA pour les
 * libellés de la mosaïque, qui sont petits. On choisit donc l'encre selon la
 * luminance relative du fond plutôt que de forcer du blanc partout.
 */
export function readableInkOn(hex: string): string {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  // 4.5:1 est le seuil AA du texte courant ; en-dessous, on passe à l'encre sombre.
  return contrastWithWhite >= 4.5 ? "#ffffff" : "#10151f";
}

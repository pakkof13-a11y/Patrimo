/**
 * Cotations du bandeau de marché — types et lecture de l'état d'une place.
 *
 * Module pur, partagé par la route qui interroge Yahoo et par le bandeau qui
 * l'affiche : les deux doivent s'accorder sur ce que veut dire « fermé ».
 */

/**
 * État d'une place, ramené à ce que l'écran sait dire.
 *
 * Yahoo distingue une demi-douzaine de phases (`PRE`, `PREPRE`, `POSTPOST`…).
 * Les nuances n'intéressent personne ici : ce qui compte est de savoir si le
 * cours affiché bouge encore. On garde donc trois états, plus l'aveu
 * d'ignorance quand la source ne dit rien.
 */
export type MarketState = "open" | "closed" | "extended" | "unknown";

export type MarketQuote = {
  key: string;
  label: string;
  /** Dernier cours connu. `null` si la source n'en a pas donné. */
  last: number | null;
  /** Variation depuis la clôture de la veille, en %. */
  changePct: number | null;
  state: MarketState;
  currency: string | null;
};

export function normalizeMarketState(raw: string | null | undefined): MarketState {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return "unknown";
  if (s === "REGULAR") return "open";
  if (s === "CLOSED" || s === "POSTPOST" || s === "PREPRE") return "closed";
  if (s === "PRE" || s === "POST") return "extended";
  return "unknown";
}

/**
 * Le cours doit-il être affiché comme vivant ?
 *
 * Hors séance, le dernier cours reste juste — c'est la clôture — mais le
 * présenter comme un cours du moment laisserait croire qu'il bouge. Le bandeau
 * affiche alors « fermé », ce que l'utilisateur a demandé et ce qui est vrai.
 */
export function isLive(state: MarketState): boolean {
  return state === "open" || state === "extended";
}

/**
 * Cours du bandeau : compact au-delà de 10 000, quatre décimales sous 10.
 *
 * Une parité EUR/USD à 1,0847 et un Dow Jones à 41 320 vivent sur la même
 * ligne ; une règle unique de décimales rendrait l'un illisible et l'autre
 * faussement précis.
 */
export function formatQuotePrice(v: number): string {
  if (v >= 10_000) {
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  }
  return v.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: v < 10 ? 4 : 2,
  });
}

export function formatQuotePct(v: number): string {
  const s = Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v >= 0 ? "+" : "−"}${s} %`;
}

/**
 * Ce que le bandeau écrit pour un instrument, en une phrase.
 *
 * Sert aussi de résumé aux lecteurs d'écran : la piste visuelle est un défilé
 * de nombres sans unité, illisible tel quel par une aide technique.
 */
export function describeQuote(q: MarketQuote): string {
  if (q.last == null) return `${q.label} : indisponible`;
  if (!isLive(q.state)) return `${q.label} : fermé`;
  const pct = q.changePct != null ? `, ${formatQuotePct(q.changePct)}` : "";
  return `${q.label} ${formatQuotePrice(q.last)}${pct}`;
}

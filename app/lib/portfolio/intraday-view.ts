/**
 * Mise en forme de la série intraday pour l'affichage.
 *
 * ## Ce que ce module fait — et surtout ne fait pas
 *
 * Il **n'évalue rien**. Aucune valorisation, aucun report, aucun échantillonnage :
 * tout cela est décidé par `/api/portfolio/intraday`, qui fait foi. Ce module se
 * borne à préparer des libellés, à retrouver le point sélectionné et à formuler
 * le repli déjà calculé par l'API.
 *
 * Recalculer ici un extrême ou une valeur créerait une seconde définition du
 * patrimoine dans le navigateur — exactement ce que les chantiers précédents
 * ont supprimé côté serveur.
 *
 * ## Pourquoi une couche séparée du composant
 *
 * Le graphique ne doit contenir aucune logique : ces fonctions sont pures, donc
 * testables sans monter de rendu, et le composant reste lisible.
 */

/** Un point tel que l'API le renvoie. Miroir du contrat, jamais élargi. */
export type IntradayApiPoint = {
  at: string;
  day: string;
  netWorth: number;
  grossAssets: number;
  liabilities: number;
  cash: number;
  securities: number;
  crypto: number;
  realEstate: number;
  lifeInsurance: number;
  alternatives: number;
  employeeSavings: number;
  otherAssets: number;
  externalFlows: number;
  status: "EXACT" | "ESTIMATED";
  estimatedComponents: string[];
};

export type IntradayApiExtremes = {
  max: { at: string; value: number };
  min: { at: string; value: number };
  drawdownEur: number;
  drawdownPct: number;
  peakAt: string;
  troughAt: string;
  recoveredAt: string | null;
};

export type IntradayApiResponse = {
  from: string;
  to: string;
  days: number;
  interval: string;
  stepMs: number;
  observedFrom: string | null;
  points: IntradayApiPoint[];
  extremes: IntradayApiExtremes | null;
};

/**
 * Point prêt pour le tracé.
 *
 * `t` est l'horodatage en millisecondes : c'est lui qui porte l'axe, afin que
 * l'espacement reflète le temps réel. Un axe indexé sur le rang des points
 * dessinerait un trou de six heures à la même largeur qu'un pas d'une heure.
 */
export type IntradayChartPoint = IntradayApiPoint & {
  t: number;
  /** Heure seule — `14:37`, fuseau de Paris. */
  timeLabel: string;
  /** Date et heure — `26 août 2026 · 14:37`. */
  fullLabel: string;
};

const PARIS = "Europe/Paris";

const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS,
  hour: "2-digit",
  minute: "2-digit",
});

const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS,
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDayFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS,
  day: "2-digit",
  month: "short",
});

/** `14:37`, dans le fuseau de l'utilisateur final. */
export function formatIntradayTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/**
 * `26 août 2026 · 14:37`.
 *
 * L'horodatage reçu est en UTC ; l'affichage est à Paris. C'est la seule
 * conversion faite ici, et elle ne touche jamais la donnée — seulement son
 * libellé.
 */
export function formatIntradayStamp(iso: string): string {
  const at = new Date(iso);
  return `${dayFmt.format(at)} · ${timeFmt.format(at)}`;
}

/** `26 août` — pour l'axe, quand le jour change. */
export function formatIntradayDay(iso: string): string {
  return shortDayFmt.format(new Date(iso));
}

/** Jour civil parisien d'un horodatage, pour détecter un changement de date. */
function parisDay(iso: string): string {
  return shortDayFmt.format(new Date(iso));
}

/** Prépare les points pour le tracé, sans en modifier une seule valeur. */
export function toChartPoints(points: IntradayApiPoint[]): IntradayChartPoint[] {
  return points.map((p) => ({
    ...p,
    t: new Date(p.at).getTime(),
    timeLabel: formatIntradayTime(p.at),
    fullLabel: formatIntradayStamp(p.at),
  }));
}

/**
 * Graduations de l'axe : une par changement de jour, plus la première.
 *
 * Sur sept jours en pas horaire, marquer chaque point donnerait 168 libellés
 * illisibles. Marquer les changements de date donne un axe qui se lit comme un
 * calendrier, et le tooltip fournit l'heure exacte quand elle est demandée.
 */
export function dayBoundaryTicks(points: IntradayChartPoint[]): number[] {
  const ticks: number[] = [];
  let previous: string | null = null;
  for (const p of points) {
    const day = parisDay(p.at);
    if (day !== previous) {
      ticks.push(p.t);
      previous = day;
    }
  }
  return ticks;
}

/**
 * Repli depuis le sommet **courant**, tel que l'API l'a mesuré.
 *
 * Rien n'est recalculé : la série reçue est échantillonnée, et en tirer un
 * extrême donnerait un repli qui varierait avec le nombre de points affichés.
 * L'API mesure sur la série complète, et c'est elle qui fait foi.
 */
export function drawdownSummary(extremes: IntradayApiExtremes | null): {
  eur: number;
  pct: number;
  peakAt: string;
  troughAt: string;
  recovered: boolean;
} | null {
  if (!extremes || extremes.drawdownEur <= 0) return null;
  return {
    eur: extremes.drawdownEur,
    pct: extremes.drawdownPct,
    peakAt: extremes.peakAt,
    troughAt: extremes.troughAt,
    recovered: extremes.recoveredAt != null,
  };
}

/** Y a-t-il au moins un point estimé ? Sert à nuancer l'en-tête, pas à alerter. */
export function hasEstimatedPoint(points: IntradayApiPoint[]): boolean {
  return points.some((p) => p.status === "ESTIMATED");
}

/**
 * Variation entre le premier et le dernier point affichés.
 *
 * Différence de deux valeurs déjà calculées — pas une performance : les
 * versements ne sont pas neutralisés, et l'en-tête ne prétend pas le contraire.
 */
export function periodDelta(points: IntradayApiPoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1]!.netWorth - points[0]!.netWorth;
}

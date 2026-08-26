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

/**
 * Couleur d'un point selon sa position par rapport à la référence.
 *
 * ## Quelle métrique est colorée
 *
 * La courbe trace le patrimoine **en valeur absolue** : 800 000 € n'est jamais
 * « négatif ». Colorer la valeur elle-même n'aurait donc aucun sens, et peindre
 * toute la série en rouge parce que la journée finit en baisse en aurait encore
 * moins.
 *
 * Ce qui est coloré est la **variation depuis le début de la période** — la
 * seule lecture pour laquelle « au-dessus » et « en dessous » veulent dire
 * quelque chose sur une courbe de patrimoine. Un patrimoine qui monte, passe
 * sous son point de départ, puis repasse au-dessus se lit donc vert → rouge →
 * vert, et la couleur ne dépend jamais de la valeur finale.
 */
export type SignTone = "positive" | "negative" | "neutral";

export function toneAgainst(value: number, reference: number): SignTone {
  if (value > reference) return "positive";
  if (value < reference) return "negative";
  return "neutral";
}

/** Tokens du design system — aucune couleur nouvelle n'est introduite. */
export const TONE_COLOR: Record<SignTone, string> = {
  positive: "var(--success)",
  negative: "var(--danger)",
  // Le design system n'a pas de token « neutre » dédié ; la teinte secondaire
  // est ce qu'il emploie partout pour une valeur qui ne penche d'aucun côté.
  neutral: "var(--muted-foreground)",
};

export type GradientStop = { offset: number; color: string };

/**
 * Arrêts de dégradé traduisant le passage au-dessus et en dessous de la
 * référence, le long de l'axe du temps.
 *
 * Recharts ne sait pas colorer une ligne segment par segment ; un dégradé le
 * fait, sans ajouter de série ni changer la primitive `Area` déjà en place.
 *
 * ## Ce que la transition n'est pas
 *
 * Le point de bascule est calculé là où le segment croise réellement la
 * référence. C'est une position de **couleur**, pas une donnée : aucun point
 * n'est ajouté à la série, aucune valeur n'est inventée, et le tooltip
 * continue de ne montrer que des observations reçues de l'API.
 */
export function signGradientStops(
  points: Array<{ t: number; netWorth: number }>,
  reference: number
): GradientStop[] {
  if (points.length === 0) return [];
  const first = points[0]!.t;
  const last = points[points.length - 1]!.t;
  const span = last - first;

  const at = (t: number) => (span <= 0 ? 0 : (t - first) / span);
  const colorOf = (v: number) => TONE_COLOR[toneAgainst(v, reference)];

  const stops: GradientStop[] = [
    { offset: 0, color: colorOf(points[0]!.netWorth) },
  ];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const prevTone = toneAgainst(prev.netWorth, reference);
    const curTone = toneAgainst(cur.netWorth, reference);
    if (prevTone === curTone) continue;

    /*
      Position du croisement sur le segment : la fraction du chemin où la
      valeur atteint la référence. Sans elle, la bascule tomberait sur le point
      suivant et la couleur mentirait sur une partie du segment.
    */
    const dv = cur.netWorth - prev.netWorth;
    const ratio = dv === 0 ? 0 : (reference - prev.netWorth) / dv;
    const crossT = prev.t + (cur.t - prev.t) * Math.min(1, Math.max(0, ratio));
    const offset = at(crossT);

    // Deux arrêts au même endroit : la transition est franche, jamais fondue.
    stops.push({ offset, color: colorOf(prev.netWorth) });
    stops.push({ offset, color: colorOf(cur.netWorth) });
  }

  stops.push({ offset: 1, color: colorOf(points[points.length - 1]!.netWorth) });
  return stops;
}

/**
 * Écart entre deux points d'observation suffisant pour parler de trou.
 *
 * Deux fois le pas : une barre manquante isolée est un trou, mais la marge
 * évite de signaler un décalage de quelques secondes.
 */
export function isGap(previousT: number, currentT: number, stepMs: number): boolean {
  return currentT - previousT > stepMs * 2;
}

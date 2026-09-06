/**
 * Géométrie d'une sparkline — normalisation d'une série en coordonnées SVG.
 *
 * Extrait de `components/ui/sparkline.tsx` sans en changer une virgule de
 * calcul : la carte de patrimoine a besoin des **coordonnées de chaque point**
 * pour poser une croix et une pastille au survol, alors que la sparkline, elle,
 * n'a besoin que des deux chaînes `points`. Recopier la formule dans le hero
 * aurait créé deux normalisations à maintenir en parallèle, et la première
 * divergence se serait vue à l'écran : une croix décalée du trait qu'elle
 * prétend désigner.
 *
 * Fonction pure, sans React ni DOM — c'est ce qui la rend testable directement.
 *
 * ## Abscisse
 *
 * Par défaut, un pas constant par point disponible (`i / (n − 1)`). C'est ce
 * qui, combiné à `downsampleSeries`, produit les marches : les journées
 * retirées n'ont pas de place réservée, et une revalorisation se lit comme un
 * saut vertical entre deux points voisins.
 *
 * Quand des dates sont fournies, l'abscisse devient **linéaire dans le temps**
 * : un palier de six mois occupe six mois de largeur, et le saut d'une
 * acquisition tient dans la journée qu'il a réellement prise. Le survol
 * aimante alors au point dont l'abscisse est la plus proche, pas au rang.
 */

export type SparklinePoint = {
  x: number;
  y: number;
  /**
   * Rang de la valeur dans le tableau d'origine.
   *
   * Distinct de la position dans `points` : les valeurs non finies sont
   * écartées du tracé, si bien que le cinquième point dessiné n'est pas
   * forcément la cinquième valeur reçue. Le survol a besoin de remonter à la
   * valeur d'origine — donc à son rang — pour en donner la date et le montant.
   */
  sourceIndex: number;
};

export type SparklineGeometry = {
  points: SparklinePoint[];
  /** Attribut `points` du `<polyline>`. */
  line: string;
  /** Attribut `points` du `<polygon>` d'aire, refermé sur le bas du cadre. */
  area: string;
  /**
   * Abscisses normalisées (0…1) des points dessinés, dans le même ordre.
   *
   * Le survol lit cette série plutôt que de recalculer : une seconde formule
   * divergerait du trait au premier changement d'échelle.
   */
  fractions: number[];
};

/**
 * Abscisses normalisées d'une série, ou pas égal si le temps n'est pas lisible.
 *
 * `timestamps` doit avoir la même longueur que le nombre de points **finis**
 * (ceux qui seront dessinés). Une date manquante, un mélange, un span nul :
 * on retombe sur le pas d'indice, qui reste défini.
 */
export function sparklineXFractions(
  count: number,
  timestamps?: Array<number | undefined>
): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const equal = Array.from({ length: count }, (_, i) => i / (count - 1));
  if (!timestamps || timestamps.length !== count) return equal;
  const ts: number[] = [];
  for (const t of timestamps) {
    if (t == null || !Number.isFinite(t)) return equal;
    ts.push(t);
  }
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  const span = max - min;
  if (span <= 0) return equal;
  return ts.map((t) => (t - min) / span);
}

export function parseSparklineTimestamp(
  value: string | number | Date | null | undefined
): number | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Coordonnées d'une série dans un cadre `width × height`, ou `null`.
 *
 * `null` en dessous de deux points finis : un segment demande deux extrémités.
 * C'est la même condition que la sparkline appliquait avant l'extraction, et
 * elle vaut aussi pour le hero — une courbe d'un seul point ne se survole pas.
 *
 * `dates` est optionnelle et alignée sur `values` (même rang). Seules les
 * valeurs finies participent au tracé ; leurs dates, si elles sont toutes
 * lisibles, placent les points sur l'axe du temps.
 */
export function sparklineGeometry(
  values: number[],
  width: number,
  height: number,
  strokeWidth: number,
  dates?: Array<string | number | Date | null | undefined>
): SparklineGeometry | null {
  const clean: Array<{ value: number; sourceIndex: number; t?: number }> = [];
  values.forEach((value, sourceIndex) => {
    if (Number.isFinite(value)) {
      clean.push({
        value,
        sourceIndex,
        t: dates ? parseSparklineTimestamp(dates[sourceIndex]) : undefined,
      });
    }
  });
  if (clean.length < 2) return null;

  const onlyValues = clean.map((c) => c.value);
  const min = Math.min(...onlyValues);
  const max = Math.max(...onlyValues);
  // Série parfaitement plate : `span` nul diviserait par zéro. Le `|| 1`
  // aplatit alors la courbe à mi-hauteur, ce qui est exactement ce qu'on veut
  // montrer d'un patrimoine qui n'a pas bougé.
  const span = max - min || 1;
  // Marge d'un demi-trait en haut et en bas : sans elle, un maximum ou un
  // minimum se retrouve rogné par le bord du viewBox.
  const pad = strokeWidth;
  const usable = height - pad * 2;

  const fractions = sparklineXFractions(
    clean.length,
    clean.map((c) => c.t)
  );

  const points: SparklinePoint[] = clean.map((c, i) => ({
    x: fractions[i]! * width,
    y: pad + usable - ((c.value - min) / span) * usable,
    sourceIndex: c.sourceIndex,
  }));

  const line = points
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  const area = `${line} ${width.toFixed(2)},${height} 0,${height}`;

  return { points, line, area, fractions };
}

/**
 * Point le plus proche d'une abscisse, en fraction de la largeur.
 *
 * L'aimantation se fait sur l'axe des rangs, pas sur celui du temps : c'est
 * ainsi que la courbe est tracée **sans dates** — un pas constant par point
 * disponible — et une aimantation temporelle désignerait un endroit du trait
 * où il n'y a rien. Les journées absentes de l'historique n'ont donc pas de
 * place réservée, ce qui revient à « aimanter au dernier point connu » sans
 * avoir à le calculer.
 *
 * `ratio` est borné : un pointeur qui déborde le cadre de quelques pixels
 * pendant un glissement désigne la première ou la dernière valeur, plutôt que
 * de sortir du tableau.
 */
export function nearestPointIndex(count: number, ratio: number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const bounded = Math.min(1, Math.max(0, ratio));
  return Math.round(bounded * (count - 1));
}

/**
 * Point dont l'abscisse normalisée est la plus proche de `ratio`.
 *
 * Sert le tracé à temps linéaire : deux points séparés d'un an occupent plus
 * de largeur que deux points du lendemain, et l'aimantation par rang
 * désignerait alors un endroit du trait où il n'y a rien.
 */
export function nearestPointByFraction(
  fractions: number[],
  ratio: number
): number {
  if (fractions.length === 0) return -1;
  if (fractions.length === 1) return 0;
  const bounded = Math.min(1, Math.max(0, ratio));
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < fractions.length; i++) {
    const dist = Math.abs(fractions[i]! - bounded);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

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
};

/**
 * Coordonnées d'une série dans un cadre `width × height`, ou `null`.
 *
 * `null` en dessous de deux points finis : un segment demande deux extrémités.
 * C'est la même condition que la sparkline appliquait avant l'extraction, et
 * elle vaut aussi pour le hero — une courbe d'un seul point ne se survole pas.
 */
export function sparklineGeometry(
  values: number[],
  width: number,
  height: number,
  strokeWidth: number
): SparklineGeometry | null {
  const clean: Array<{ value: number; sourceIndex: number }> = [];
  values.forEach((value, sourceIndex) => {
    if (Number.isFinite(value)) clean.push({ value, sourceIndex });
  });
  if (clean.length < 2) return null;

  const onlyValues = clean.map((c) => c.value);
  const min = Math.min(...onlyValues);
  const max = Math.max(...onlyValues);
  // Série parfaitement plate : `span` nul diviserait par zéro. Le `|| 1`
  // aplatit alors la courbe à mi-hauteur, ce qui est exactement ce qu'on veut
  // montrer d'un patrimoine qui n'a pas bougé.
  const span = max - min || 1;
  const stepX = width / (clean.length - 1);
  // Marge d'un demi-trait en haut et en bas : sans elle, un maximum ou un
  // minimum se retrouve rogné par le bord du viewBox.
  const pad = strokeWidth;
  const usable = height - pad * 2;

  const points: SparklinePoint[] = clean.map((c, i) => ({
    x: i * stepX,
    y: pad + usable - ((c.value - min) / span) * usable,
    sourceIndex: c.sourceIndex,
  }));

  const line = points
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  const area = `${line} ${width.toFixed(2)},${height} 0,${height}`;

  return { points, line, area };
}

/**
 * Point le plus proche d'une abscisse, en fraction de la largeur.
 *
 * L'aimantation se fait sur l'axe des rangs, pas sur celui du temps : c'est
 * ainsi que la courbe est tracée — un pas constant par point disponible — et
 * une aimantation temporelle désignerait un endroit du trait où il n'y a rien.
 * Les journées absentes de l'historique n'ont donc pas de place réservée, ce
 * qui revient à « aimanter au dernier point connu » sans avoir à le calculer.
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

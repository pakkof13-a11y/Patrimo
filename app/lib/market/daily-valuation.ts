/**
 * Valorisation d'un panier à une date, depuis les clôtures connues.
 *
 * ## Le défaut que ce module supprime
 *
 * L'assurance-vie et la poche crypto construisaient chacune leur courbe avec
 * la même boucle :
 *
 * ```ts
 * let valueEur = 0;
 * for (const [assetId, qty] of held) {
 *   const close = closeAtOrBefore(index.get(assetId), day);
 *   if (close == null) continue;   // ← la ligne disparaît, le total reste
 *   valueEur += qty * close;
 * }
 * points.push({ day, valueEur });  // ← un point est écrit quoi qu'il arrive
 * ```
 *
 * Un jour où aucune clôture n'est connue produisait donc un point à **0 €**,
 * et un jour où la moitié des lignes manquait produisait un point **amputé**.
 * Dans les deux cas la courbe descendait, puis remontait le jour où le cache
 * se remplissait — un décrochage que rien dans le portefeuille n'avait causé.
 *
 * Ce n'est pas une approximation : c'est un point fabriqué pour que l'axe des
 * abscisses reste continu. Une absence de donnée doit rester une absence de
 * donnée.
 *
 * ## La règle retenue : complet, ou absent
 *
 * Un total n'a de sens que si **toutes** les lignes détenues ce jour-là sont
 * valorisées. Il n'existe pas de « total partiel » : la somme de trois lignes
 * sur cinq n'est pas une valeur du panier approchée, c'est la valeur d'un autre
 * panier.
 *
 * Les supports que les fournisseurs ignorent **entièrement** ne relèvent pas de
 * cette règle : ils sont écartés en amont par les appelants (`covered`) et
 * comptés à part, au montant investi. Sans quoi un seul fonds euro sans
 * cotation supprimerait toute la courbe.
 *
 * ## Report, oui ; interpolation, non
 *
 * `closeAtOrBefore` reporte la dernière clôture **antérieurement observée** :
 * un week-end, un jour férié ou un trou fournisseur n'interrompt pas la série,
 * parce que la valeur reportée est identique à une observation réelle et
 * identifiable — c'est le sens de `ESTIMATED`. Rien n'est deviné vers l'avenir,
 * et aucune valeur intermédiaire n'est calculée entre deux observations.
 *
 * Avant la **première** clôture d'une ligne, il n'y a rien à reporter : le jour
 * est déclaré incomplet, et le point n'existe pas.
 */

import {
  closeAtOrBefore,
  type DailyCloseIndex,
  type DayKey,
} from "../portfolio/class-history";

/** Une ligne détenue à une date : quantité non nulle. */
export type HeldQuantity = { assetId: string; quantity: number };

export type DailyValuation =
  | {
      /** Toutes les lignes détenues sont valorisées : le total est publiable. */
      complete: true;
      valueEur: number;
      /** Lignes dont la clôture a été reportée depuis un jour antérieur. */
      carried: string[];
    }
  | {
      /** Au moins une ligne n'a aucune clôture à cette date : pas de point. */
      complete: false;
      /** Les lignes qui manquent — de quoi expliquer le trou, pas le combler. */
      missing: string[];
    };

/**
 * Valorise les lignes détenues un jour donné.
 *
 * Un panier **vide** est complet et vaut 0 : ne rien détenir est une
 * information exacte, et non une absence de donnée. C'est le cas d'un contrat
 * avant sa première opération ou après son rachat total — la courbe doit y
 * passer par zéro, parce que zéro est la réponse juste.
 */
export function valueHeldAtDay(
  held: readonly HeldQuantity[],
  closes: DailyCloseIndex,
  day: DayKey
): DailyValuation {
  let valueEur = 0;
  const carried: string[] = [];
  const missing: string[] = [];

  for (const { assetId, quantity } of held) {
    if (quantity === 0) continue;

    const index = closes.get(assetId);
    const close = closeAtOrBefore(index, day);
    if (close == null) {
      missing.push(assetId);
      continue;
    }
    /*
      Une clôture reportée reste une donnée réelle, mais elle n'a pas été
      observée ce jour-là. L'appelant en a besoin pour marquer le point
      `ESTIMATED` plutôt que `EXACT`.
    */
    if (!index?.has(day)) carried.push(assetId);
    valueEur += quantity * close;
  }

  if (missing.length > 0) return { complete: false, missing };
  return { complete: true, valueEur, carried };
}

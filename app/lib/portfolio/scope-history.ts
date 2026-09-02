import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Projette la série d'historique sur le périmètre affiché.
 *
 * Le périmètre est choisi **avant** l'agrégation, jamais après : le total est
 * réécrit en amont pour qu'une seule grandeur circule ensuite dans toute la
 * chaîne — deltas, rebasage du comparatif, infobulles, croissance chaînée.
 *
 * La règle qui fait la justesse de l'ensemble : **la performance suit le
 * périmètre de la valeur**. Réécrire le total sans réécrire
 * `investmentPerformanceBase` laissait chaîner le résultat du portefeuille
 * entier sur la valeur d'une seule classe. Quand la performance du périmètre
 * n'existe pas, elle est déclarée absente plutôt que remplacée.
 *
 * Extrait du composant pour être éprouvable : c'est ici que se décide un
 * pourcentage affiché à l'utilisateur.
 */
export function scopeHistory(
  history: HistoryPoint[],
  opts: {
    scope: string;
    assetClass: string | null;
    envelope: string | null;
    classMetric: string;
  }
): HistoryPoint[] {
  const { scope, assetClass, envelope, classMetric } = opts;
  /*
    Une classe isolée passe par le même chemin que « patrimoine net » : le
    total est réécrit **en amont**, et toute la chaîne d'affichage — deltas,
    rebasage du comparatif, infobulles — travaille ensuite sur une seule
    grandeur. Filtrer en aval aurait laissé les variations calculées sur le
    patrimoine entier sous une étiquette de classe.

    Les points dont la ventilation est absente sont **retirés**, jamais
    ramenés à zéro : une ventilation inconnue n'est pas une classe vide, et
    la courbe doit s'interrompre là où la donnée s'arrête.
  */
  /*
    Croisement classe × enveloppe : même chemin que les classes, le total est
    réécrit en amont pour que deltas, rebasage et infobulles travaillent tous
    sur la grandeur affichée.

    Le croisement est lu dans la série, jamais reconstruit ici : la valeur
    d'une action en PEA à une date est celle que le moteur a calculée, avec le
    même prix et le même statut que partout ailleurs.

    Les points sans ventilation sont **retirés** : une période antérieure au
    journal ne dit rien, et la ramener à zéro affirmerait une enveloppe vide.
  */
  if (assetClass && envelope) {
    const out = [];
    for (const p of history) {
      const v = p.byAssetClassAndEnvelopeBase?.[assetClass]?.[envelope];
      if (v == null) continue;
      /*
        La performance reste celle du portefeuille entier dans le point
        d'origine : la garder ici ferait chaîner un résultat global sur une
        valeur d'enveloppe, donc un pourcentage sans rapport. Le moteur ne
        publie pas de performance par enveloppe — c'est une limitation
        connue —, on la déclare donc absente plutôt que fausse.
      */
      out.push({
        ...p,
        totalValueBase: v,
        totalValueEur: v,
        netWorthBase: v,
        investmentPerformanceBase: undefined,
      });
    }
    return out;
  }

  if (assetClass) {
    const out = [];
    /*
      Deux lectures possibles de la même classe.

      « Valeur » trace l'encours, apports compris. « Performance » trace ce
      que le marché a produit, une fois les mouvements de capitaux retirés —
      c'est un **cumul** de résultats quotidiens, pas un encours, d'où
      l'accumulation ci-dessous. Les présenter sous le même nom ferait passer
      un versement pour un gain.

      La performance n'existe pas au premier point d'une série : sans veille,
      rien n'est comparable. Ces points sont écartés plutôt que ramenés à
      zéro.
    */
    let cumul = 0;
    for (const p of history) {
      if (classMetric === "performance") {
        const perf = p.performanceByAssetClassBase?.[assetClass];
        if (perf == null) continue;
        cumul += perf;
        /*
          Le total tracé est ici un cumul de résultats, pas un encours.
          Chaîner une performance sur un cumul n'aurait aucun sens : la
          croissance relative n'est pas définie sur cette courbe.
        */
        out.push({
          ...p,
          totalValueBase: cumul,
          totalValueEur: cumul,
          netWorthBase: cumul,
          investmentPerformanceBase: undefined,
        });
        continue;
      }
      const v = p.byAssetClassBase?.[assetClass];
      if (v == null) continue;
      /*
        La performance suit le périmètre de la valeur.

        Le point conservait `investmentPerformanceBase`, c'est-à-dire le
        résultat du portefeuille **entier**, pendant que le total devenait
        celui d'une seule classe. La croissance chaînée valait alors
        `1 + résultat global / valeur de la classe` : mesuré sur une classe
        de 10 000 € dans un portefeuille de 100 000 €, une hausse réelle de
        2 % s'affichait à 20 %, soit le rapport des deux périmètres.

        Le moteur publie la décomposition par classe — même arithmétique,
        terme à terme. C'est elle qu'on prend, et son absence se dit.
      */
      out.push({
        ...p,
        totalValueBase: v,
        totalValueEur: v,
        netWorthBase: v,
        investmentPerformanceBase:
          p.performanceByAssetClassBase?.[assetClass] ?? undefined,
      });
    }
    return out;
  }
  if (scope !== "net") return history;
  return history.map((p) =>
    p.netWorthBase == null
      ? p
      : { ...p, totalValueBase: p.netWorthBase, totalValueEur: p.netWorthBase }
  );
}

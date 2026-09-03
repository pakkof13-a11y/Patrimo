import { describe, expect, it } from "vitest";
import {
  heroAttribution,
  heroEventMarkers,
  HERO_EVENT_FLOW_THRESHOLD,
} from "@/app/lib/portfolio/hero-attribution";
import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Marché contre flux.
 *
 * Le défaut que ces tests empêchent est précis : une acquisition qui se lit
 * comme une performance. Un patrimoine qui passe de 900 k€ à 1,9 M€ le jour
 * d'un achat immobilier n'a rien gagné, et l'écran doit le dire. Les cas
 * couverts sont ceux du chantier — apport, hausse des cotés, entrée d'un bien,
 * revalorisation illiquide, remboursement de crédit.
 */

function pt(over: Partial<HistoryPoint> & { date: string }): HistoryPoint {
  return {
    label: over.date.slice(0, 10),
    totalValueEur: 0,
    cashTotalEur: 0,
    totalValueBase: 0,
    cashTotalBase: 0,
    ...over,
  };
}

/** Une journée : valeur brute, passifs, flux du jour. */
function jour(
  date: string,
  gross: number,
  flow: number,
  liabilities = 0
): HistoryPoint {
  return pt({
    date,
    grossAssetsBase: gross,
    netWorthBase: gross - liabilities,
    liabilitiesBase: liabilities,
    externalFlowsBase: flow,
  });
}

describe("identité variation = marché + flux", () => {
  it("un apport de 50 k€ n'est pas une performance", () => {
    const fenetre = [
      jour("2026-01-01T22:59:59.999Z", 100_000, 0),
      jour("2026-01-02T22:59:59.999Z", 150_000, 50_000),
    ];
    const a = heroAttribution(fenetre, "gross")!;

    expect(a.variation).toBe(50_000);
    expect(a.flow).toBe(50_000);
    // Rien n'a été produit : tout vient de l'argent apporté.
    expect(a.market).toBe(0);
  });

  it("une hausse des cotés de 2 k€ est du marché, pas un flux", () => {
    const fenetre = [
      jour("2026-01-01T22:59:59.999Z", 100_000, 0),
      jour("2026-01-02T22:59:59.999Z", 102_000, 0),
    ];
    const a = heroAttribution(fenetre, "gross")!;

    expect(a.variation).toBe(2_000);
    expect(a.flow).toBe(0);
    expect(a.market).toBe(2_000);
  });

  it("l'entrée d'un appartement à 980 k€ est un flux, pas un gain", () => {
    /*
      Le critère du chantier : sur une fenêtre qui contient l'entrée d'un bien,
      « Flux ≈ valeur d'entrée, Marché ≈ le reste ». Ici le reste est la hausse
      de 2 k€ des cotés survenue le même jour.
    */
    const fenetre = [
      jour("2026-01-01T22:59:59.999Z", 100_000, 0),
      jour("2026-01-02T22:59:59.999Z", 1_082_000, 980_000),
    ];
    const a = heroAttribution(fenetre, "gross")!;

    expect(a.variation).toBe(982_000);
    expect(a.flow).toBe(980_000);
    expect(a.market).toBe(2_000);
  });

  it("une revalorisation de SCPI de +3 k€ est du marché", () => {
    // Aucun capital n'est entré : c'est un changement de juste valeur.
    const fenetre = [
      jour("2026-02-01T22:59:59.999Z", 500_000, 0),
      jour("2026-02-02T22:59:59.999Z", 503_000, 0),
    ];
    const a = heroAttribution(fenetre, "gross")!;

    expect(a.flow).toBe(0);
    expect(a.market).toBe(3_000);
  });

  it("le scénario complet reste cohérent terme à terme", () => {
    /*
      Apport 50 k€, cotés +2 k€, entrée d'un appartement à 980 k€, SCPI +3 k€ :
      la variation vaut 1 035 000 €, dont 1 030 000 € de capitaux apportés et
      5 000 € seulement de marché.
    */
    const fenetre = [
      jour("2026-01-01T22:59:59.999Z", 100_000, 0),
      jour("2026-01-02T22:59:59.999Z", 152_000, 50_000), // apport + cotés
      jour("2026-01-03T22:59:59.999Z", 1_132_000, 980_000), // entrée du bien
      jour("2026-01-04T22:59:59.999Z", 1_135_000, 0), // revalo SCPI
    ];
    const a = heroAttribution(fenetre, "gross")!;

    expect(a.variation).toBe(1_035_000);
    expect(a.flow).toBe(1_030_000);
    expect(a.market).toBe(5_000);
    expect(a.market + a.flow).toBe(a.variation);
  });
});

describe("mode net — les passifs rejoignent les flux", () => {
  it("un emprunt débloqué ne change pas le patrimoine net", () => {
    /*
      200 k€ entrent en cash *et* en dette. Les deux s'annulent : le net ne
      bouge pas, et rien de tout cela n'est une performance.
    */
    const fenetre = [
      jour("2026-03-01T22:59:59.999Z", 100_000, 0, 0),
      jour("2026-03-02T22:59:59.999Z", 300_000, 200_000, 200_000),
    ];
    const a = heroAttribution(fenetre, "net")!;

    expect(a.variation).toBe(0);
    expect(a.flow).toBe(0);
    expect(a.market).toBe(0);
  });

  it("un remboursement de capital de 1 k€ n'est pas un gain", () => {
    // Le cash sort, la dette baisse d'autant : conversion, pas performance.
    const fenetre = [
      jour("2026-03-01T22:59:59.999Z", 300_000, 0, 200_000),
      jour("2026-03-02T22:59:59.999Z", 299_000, -1_000, 199_000),
    ];
    const a = heroAttribution(fenetre, "net")!;

    expect(a.variation).toBe(0);
    expect(a.flow).toBe(0);
    expect(a.market).toBe(0);
  });

  it("le marché est le même en net et en brut", () => {
    /*
      Propriété remarquable de la décomposition : seul le flux change d'un mode
      à l'autre, puisque le mouvement des dettes n'est jamais du marché. Si un
      jour les deux marchés divergeaient, c'est que les passifs auraient été
      comptés comme performance quelque part.
    */
    const fenetre = [
      jour("2026-04-01T22:59:59.999Z", 500_000, 0, 100_000),
      jour("2026-04-02T22:59:59.999Z", 560_000, 50_000, 90_000),
    ];
    const brut = heroAttribution(fenetre, "gross")!;
    const net = heroAttribution(fenetre, "net")!;

    expect(brut.market).toBe(10_000);
    expect(net.market).toBe(10_000);
    // Le flux net retire la baisse de dette du flux brut.
    expect(net.flow).toBe(brut.flow + 10_000);
    expect(net.market + net.flow).toBe(net.variation);
  });
});

describe("l'ancre borne la fenêtre sans y entrer", () => {
  it("les flux du point d'ancrage ne sont pas comptés", () => {
    /*
      `windowForRange` conserve en tête le dernier relevé **avant** la période.
      Il donne la valeur de départ ; ses propres flux appartiennent à la veille,
      et les compter gonflerait la fenêtre d'un apport qui lui est antérieur.
    */
    const fenetre = [
      jour("2026-01-01T22:59:59.999Z", 100_000, 90_000), // ancre : flux d'avant
      jour("2026-01-02T22:59:59.999Z", 110_000, 0),
    ];
    const a = heroAttribution(fenetre, "gross")!;

    expect(a.flow).toBe(0);
    expect(a.market).toBe(10_000);
  });
});

describe("dégradation propre", () => {
  it("sans flux publiés, rien n'est affirmé", () => {
    /*
      Une réponse d'API qui ne porte pas les flux ne dit pas « aucun capital
      n'est entré » : elle ne dit rien. « Flux 0 € » serait une affirmation.
    */
    const fenetre = [
      pt({ date: "2026-01-01T22:59:59.999Z", grossAssetsBase: 100_000 }),
      pt({ date: "2026-01-02T22:59:59.999Z", grossAssetsBase: 110_000 }),
    ];
    expect(heroAttribution(fenetre, "gross")).toBeNull();
  });

  it("un seul jour sans flux suffit à tout retenir", () => {
    const fenetre = [
      jour("2026-01-01T22:59:59.999Z", 100_000, 0),
      pt({ date: "2026-01-02T22:59:59.999Z", grossAssetsBase: 105_000 }),
      jour("2026-01-03T22:59:59.999Z", 110_000, 0),
    ];
    expect(heroAttribution(fenetre, "gross")).toBeNull();
  });

  it("en net, des passifs manquants empêchent l'attribution", () => {
    const fenetre = [
      pt({
        date: "2026-01-01T22:59:59.999Z",
        grossAssetsBase: 100_000,
        netWorthBase: 100_000,
        externalFlowsBase: 0,
      }),
      pt({
        date: "2026-01-02T22:59:59.999Z",
        grossAssetsBase: 110_000,
        netWorthBase: 110_000,
        externalFlowsBase: 0,
      }),
    ];
    expect(heroAttribution(fenetre, "net")).toBeNull();
    // En brut, la même fenêtre reste exploitable.
    expect(heroAttribution(fenetre, "gross")).not.toBeNull();
  });

  it("moins de deux points : aucune attribution", () => {
    expect(heroAttribution([], "gross")).toBeNull();
    expect(
      heroAttribution([jour("2026-01-01T22:59:59.999Z", 1, 0)], "gross")
    ).toBeNull();
  });
});

describe("repères d'événements sur la courbe", () => {
  it("ne retient que les mouvements au-dessus du seuil", () => {
    const marqueurs = heroEventMarkers([
      { index: 0, amount: 100 },
      { index: 1, amount: HERO_EVENT_FLOW_THRESHOLD },
      { index: 2, amount: -20_000 },
      { index: 3, amount: undefined },
    ]);
    expect(marqueurs.map((m) => m.index)).toEqual([1, 2]);
  });

  it("garde les cinq plus gros, entrées comme sorties", () => {
    /*
      Le tri porte sur la valeur absolue : une sortie de 200 k€ explique la
      courbe autant qu'une entrée du même montant.
    */
    const marqueurs = heroEventMarkers(
      [
        { index: 0, amount: 6_000 },
        { index: 1, amount: -200_000 },
        { index: 2, amount: 50_000 },
        { index: 3, amount: 7_000 },
        { index: 4, amount: 980_000 },
        { index: 5, amount: 8_000 },
        { index: 6, amount: 9_000 },
      ],
      5_000,
      5
    );
    expect(marqueurs).toHaveLength(5);
    /*
      Les deux plus petits mouvements sautent : 6 000 € (rang 0) et 7 000 €
      (rang 3). Restent, par ordre d'importance, 980 000 · −200 000 · 50 000 ·
      9 000 · 8 000 — rendus dans l'ordre du temps pour que les repères se
      posent de gauche à droite.
    */
    expect(marqueurs.map((m) => m.index)).toEqual([1, 2, 4, 5, 6]);
    expect(marqueurs.map((m) => m.amount)).toEqual([
      -200_000, 50_000, 980_000, 8_000, 9_000,
    ]);
  });

  it("dix ans d'historique ne posent pas deux cents pastilles", () => {
    const beaucoup = Array.from({ length: 400 }, (_, i) => ({
      index: i,
      amount: 10_000 + i,
    }));
    expect(heroEventMarkers(beaucoup)).toHaveLength(5);
  });
});

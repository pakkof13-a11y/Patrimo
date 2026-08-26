/**
 * Garde-fou des courbes KPI.
 *
 * Chaque test répond à une seule question : **quelle donnée réelle permet
 * d'affirmer que cette valeur était celle-ci à cette date ?** Quand la réponse
 * est « aucune », le point ne doit pas exister.
 *
 * ## Nature des données utilisées ici
 *
 * Tout ce qui suit est une **fixture de test** construite dans le fichier :
 * aucune donnée réelle, aucun seed, aucun fournisseur contacté. Ces tests ne
 * valident donc pas une intégration fournisseur — ils valident l'arithmétique
 * et les refus de la couche d'affichage.
 */

import { describe, expect, it } from "vitest";
import { valueHeldAtDay } from "@/app/lib/market/daily-valuation";
import type { DailyCloseIndex } from "@/app/lib/portfolio/class-history";
import { downsampleSeries } from "@/app/lib/portfolio/service";

/** Fabrique un index de clôtures : `{ actif: { jour: cours } }`. */
function index(spec: Record<string, Record<string, number>>): DailyCloseIndex {
  return new Map(
    Object.entries(spec).map(([assetId, byDay]) => [
      assetId,
      new Map(Object.entries(byDay)),
    ])
  );
}

describe("valorisation quotidienne — complet ou absent", () => {
  it("aucune clôture : aucun point, et non un point à 0 €", () => {
    /*
      Le défaut historique : la boucle sautait la ligne sans clôture mais
      publiait quand même le total, qui valait donc 0. La courbe tombait à
      zéro un jour où le portefeuille n'avait pas bougé.
    */
    const res = valueHeldAtDay([{ assetId: "btc", quantity: 2 }], index({}), "2026-03-10");

    expect(res.complete).toBe(false);
    expect(res).not.toHaveProperty("valueEur");
    if (!res.complete) expect(res.missing).toEqual(["btc"]);
  });

  it("panier partiellement valorisable : aucun total amputé", () => {
    // `eth` est coté, `btc` ne l'est pas encore. Publier 3 000 € donnerait la
    // valeur d'un autre panier, pas une approximation de celui-ci.
    const res = valueHeldAtDay(
      [
        { assetId: "btc", quantity: 1 },
        { assetId: "eth", quantity: 2 },
      ],
      index({ eth: { "2026-03-10": 1500 } }),
      "2026-03-10"
    );

    expect(res.complete).toBe(false);
    if (!res.complete) expect(res.missing).toEqual(["btc"]);
  });

  it("clôture du jour : total exact, rien de reporté", () => {
    const res = valueHeldAtDay(
      [{ assetId: "eth", quantity: 2 }],
      index({ eth: { "2026-03-10": 1500 } }),
      "2026-03-10"
    );

    expect(res).toEqual({ complete: true, valueEur: 3000, carried: [] });
  });

  it("week-end : la clôture de vendredi est reportée et signalée ESTIMATED", () => {
    // Samedi 2026-03-14 : le marché n'a pas coté. La valeur du vendredi est
    // une donnée réelle, identifiable et datée — elle est reportée, pas devinée.
    const closes = index({ eth: { "2026-03-13": 1500 } });

    const vendredi = valueHeldAtDay([{ assetId: "eth", quantity: 2 }], closes, "2026-03-13");
    const samedi = valueHeldAtDay([{ assetId: "eth", quantity: 2 }], closes, "2026-03-14");

    expect(vendredi).toEqual({ complete: true, valueEur: 3000, carried: [] });
    expect(samedi).toEqual({ complete: true, valueEur: 3000, carried: ["eth"] });
  });

  it("avant la première clôture : rien à reporter, donc aucun point", () => {
    // Le report ne regarde que le passé. Appliquer la clôture du 10 au 9
    // reviendrait à projeter une valeur actuelle dans le passé.
    const res = valueHeldAtDay(
      [{ assetId: "eth", quantity: 2 }],
      index({ eth: { "2026-03-10": 1500 } }),
      "2026-03-09"
    );

    expect(res.complete).toBe(false);
  });

  it("deux observations : aucune valeur intermédiaire n'est inventée", () => {
    // 100 le 1er, 200 le 3. Le 2 doit valoir 100 — la dernière observation
    // réelle — et surtout pas 150, qui n'a jamais été observé.
    const closes = index({ x: { "2026-03-01": 100, "2026-03-03": 200 } });
    const jour2 = valueHeldAtDay([{ assetId: "x", quantity: 1 }], closes, "2026-03-02");

    expect(jour2).toEqual({ complete: true, valueEur: 100, carried: ["x"] });
  });

  it("trou fournisseur : le report ne saute pas par-dessus vers la valeur suivante", () => {
    /*
      La série du chantier :
        10:00 → 100   11:00 → 101   12:00 → ABSENT   13:00 → 99
      Transposée en jours. Le 12 doit valoir 101, jamais une moyenne de
      101 et 99, ni une valeur glissée depuis le 13.
    */
    const closes = index({
      x: { "2026-03-10": 100, "2026-03-11": 101, "2026-03-13": 99 },
    });

    expect(valueHeldAtDay([{ assetId: "x", quantity: 1 }], closes, "2026-03-12")).toEqual({
      complete: true,
      valueEur: 101,
      carried: ["x"],
    });
  });

  it("panier vide : zéro est une réponse exacte, pas une absence", () => {
    // Un contrat racheté totalement vaut zéro, et la courbe doit le dire.
    expect(valueHeldAtDay([], index({}), "2026-03-10")).toEqual({
      complete: true,
      valueEur: 0,
      carried: [],
    });
  });

  it("quantité nulle : la ligne soldée n'exige pas de cours", () => {
    // Sans cela, une ligne vendue il y a deux ans dont le cache a expiré
    // supprimerait la courbe entière.
    expect(
      valueHeldAtDay([{ assetId: "vendu", quantity: 0 }], index({}), "2026-03-10")
    ).toEqual({ complete: true, valueEur: 0, carried: [] });
  });

  it("valeur actuelle ≠ valeur historique : l'actuelle n'est jamais rétro-projetée", () => {
    // La seule clôture connue est celle d'aujourd'hui. Aucun jour antérieur ne
    // doit en hériter.
    const closes = index({ x: { "2026-03-20": 500 } });
    for (const day of ["2026-03-17", "2026-03-18", "2026-03-19"]) {
      expect(valueHeldAtDay([{ assetId: "x", quantity: 1 }], closes, day).complete).toBe(
        false
      );
    }
    expect(valueHeldAtDay([{ assetId: "x", quantity: 1 }], closes, "2026-03-20")).toEqual({
      complete: true,
      valueEur: 500,
      carried: [],
    });
  });
});

describe("le défaut corrigé, mis en regard", () => {
  /**
   * La boucle telle qu'elle existait dans `performance-service` et
   * `spot-history-service`, reproduite ici pour que l'écart reste mesurable.
   *
   * Elle n'est plus appelée nulle part : elle sert de témoin. Si un jour une
   * courbe recommençait à publier un total amputé, ce test dirait exactement de
   * combien.
   */
  function ancienneBoucle(
    held: readonly { assetId: string; quantity: number }[],
    closes: DailyCloseIndex,
    day: string
  ): number {
    let valueEur = 0;
    for (const { assetId, quantity } of held) {
      const byDay = closes.get(assetId);
      let close: number | null = null;
      for (const [k, v] of byDay ?? []) if (k <= day && (close == null || k <= day)) close = v;
      if (close == null) continue; // ← la ligne disparaît…
      valueEur += quantity * close;
    }
    return valueEur; // ← …mais le total est publié quand même
  }

  const panier = [
    { assetId: "btc", quantity: 1 },
    { assetId: "eth", quantity: 2 },
  ];

  it("un jour sans aucune cotation valait 0 € ; il n'a plus de point", () => {
    const closes = index({});

    expect(ancienneBoucle(panier, closes, "2026-03-10")).toBe(0);
    expect(valueHeldAtDay(panier, closes, "2026-03-10").complete).toBe(false);
  });

  it("un jour à moitié coté valait la moitié du portefeuille", () => {
    // 30 000 € détenus, 3 000 € affichés : un décrochage de 90 % qu'aucune
    // position ne justifie, effacé dès que le cache se remplit.
    const closes = index({ eth: { "2026-03-10": 1500 } });

    expect(ancienneBoucle(panier, closes, "2026-03-10")).toBe(3000);
    expect(valueHeldAtDay(panier, closes, "2026-03-10").complete).toBe(false);
  });

  it("quand tout est coté, les deux donnent le même total", () => {
    // La correction ne déplace aucune valeur : elle retire des points faux.
    const closes = index({
      btc: { "2026-03-10": 60_000 },
      eth: { "2026-03-10": 1500 },
    });

    const nouveau = valueHeldAtDay(panier, closes, "2026-03-10");
    expect(nouveau.complete).toBe(true);
    if (nouveau.complete) {
      expect(nouveau.valueEur).toBe(ancienneBoucle(panier, closes, "2026-03-10"));
      expect(nouveau.valueEur).toBe(63_000);
    }
  });
});

describe("downsampling — une transformation d'affichage, rien de plus", () => {
  /**
   * Série longue et calme, avec statuts et un flux.
   *
   * Calme volontairement : `downsampleSeries` conserve d'office tout point
   * portant un mouvement notable et les quatre cents derniers jours. Une série
   * agitée serait conservée en entier et ne testerait donc rien.
   *
   * Le passage `ESTIMATED` → `EXACT` est placé au tout début, loin de la queue
   * gardée au jour le jour : c'est là que l'échantillonnage peut l'effacer.
   */
  function longSeries(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      day: `j${String(i).padStart(5, "0")}`,
      grossAssets: 100_000 + i * 0.1,
      externalFlows: i === 12 ? 3_000 : 0,
      status: i < 40 ? ("ESTIMATED" as const) : ("EXACT" as const),
    }));
  }

  const N = 6_000;

  it("ne modifie aucune valeur conservée", () => {
    const full = longSeries(N);
    const shown = downsampleSeries(full, 300);

    expect(shown.length).toBeLessThan(full.length);
    // Chaque point rendu est, à l'identité près, un point de la série d'origine.
    for (const p of shown) expect(full).toContain(p);
  });

  it("conserve le premier et le dernier point", () => {
    const full = longSeries(N);
    const shown = downsampleSeries(full, 300);

    expect(shown[0]).toBe(full[0]);
    expect(shown[shown.length - 1]).toBe(full[full.length - 1]);
  });

  it("ne crée aucun point", () => {
    const full = longSeries(N);
    const shown = downsampleSeries(full, 300);
    const jours = new Set(full.map((p) => p.day));

    for (const p of shown) expect(jours.has(p.day)).toBe(true);
  });

  it("conserve la transition EXACT / ESTIMATED", () => {
    /*
      Sans cela, l'échantillonnage peut retirer précisément les deux points qui
      encadrent le passage d'estimé à exact : la courbe reste tracée, mais
      l'écran ne sait plus dire où la mesure a commencé. Une valeur n'est pas
      modifiée — c'est son statut qui disparaît, ce qui est aussi trompeur.
    */
    const full = longSeries(N);
    const shown = downsampleSeries(full, 200);

    const transitions = (s: typeof full) =>
      s.filter((p, i) => i > 0 && s[i - 1]!.status !== p.status).map((p) => p.day);

    expect(transitions(shown)).toEqual(transitions(full));
  });

  it("une série courte est rendue telle quelle", () => {
    const full = longSeries(50);
    expect(downsampleSeries(full, 300)).toBe(full);
  });

  it("changer la borne d'affichage ne change aucune valeur historique", () => {
    const full = longSeries(N);
    const large = downsampleSeries(full, 900);
    const etroit = downsampleSeries(full, 200);

    // Les deux rendus n'ont pas le même nombre de points, mais tout point
    // présent dans les deux porte exactement la même valeur.
    const parJour = new Map(large.map((p) => [p.day, p.grossAssets]));
    for (const p of etroit) {
      const attendu = parJour.get(p.day);
      if (attendu != null) expect(p.grossAssets).toBe(attendu);
    }
  });
});

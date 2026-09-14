import { describe, expect, it } from "vitest";
import {
  historyFloorDay,
  lastCloseDay,
  seriesEmissionDays,
} from "@/app/lib/portfolio/historical/history-window";
import { previousDay } from "@/app/lib/portfolio/historical/timeline";
import { parisDayKey } from "@/app/lib/dates/paris";

/*
  La courbe s'arrête à la dernière clôture.

  Décision produit, pas correction mesurée : un point du jour mélange une
  journée inachevée à une série de journées closes. Ces contrôles épinglent la
  borne et son articulation avec le pas hebdomadaire — pas la valeur du jour où
  ils tournent.
*/
describe("lastCloseDay", () => {
  it("rend la veille du jour parisien", () => {
    expect(lastCloseDay(new Date("2026-09-07T11:00:00.000Z"))).toBe(
      "2026-09-06"
    );
  });

  it("recule d'un jour civil, pas de vingt-quatre heures d'horloge", () => {
    // 00:30 UTC le 8 = 02:30 le 8 à Paris ; la veille parisienne est le 7.
    expect(lastCloseDay(new Date("2026-09-08T00:30:00.000Z"))).toBe(
      "2026-09-07"
    );
    // 23:30 UTC le 7 = 01:30 le 8 à Paris ; la veille est le 7 également.
    expect(lastCloseDay(new Date("2026-09-07T23:30:00.000Z"))).toBe(
      "2026-09-07"
    );
  });

  it("traverse les mois et les années", () => {
    expect(lastCloseDay(new Date("2026-03-01T12:00:00.000Z"))).toBe(
      "2026-02-28"
    );
    expect(lastCloseDay(new Date("2026-01-01T12:00:00.000Z"))).toBe(
      "2025-12-31"
    );
  });

  it("reste sous le plafond de profondeur", () => {
    const now = new Date("2026-09-07T11:00:00.000Z");
    expect(lastCloseDay(now) > historyFloorDay(now)).toBe(true);
  });
});

/*
  Bascules d'heure — la veille est un jour civil Paris, pas vingt-quatre heures.

  Un jour UTC dure toujours 24 h ; un jour civil Paris en dure 23 le dimanche
  de l'avance et 25 le dimanche du recul. Décrémenter le jour UTC puis relire
  le jour parisien produit donc deux fenêtres fausses par an, isolées ici au
  quart d'heure. Les instants sont écrits en UTC : l'heure de Paris annoncée en
  commentaire est celle que ces contrôles épinglent.
*/
describe("lastCloseDay aux bascules d'heure", () => {
  it("avance du 29 mars 2026 : minuit passé le 30 rend bien le 29", () => {
    // Le 29/03 ne dure que 23 h. Entre 00 h et 01 h Paris le 30, `now − 24 h`
    // retombait dans le 28 : le 29 disparaissait de la courbe.
    // 22:00Z le 29 = 00:00 Paris le 30 (GMT+2).
    expect(lastCloseDay(new Date("2026-03-29T22:00:00.000Z"))).toBe(
      "2026-03-29"
    );
    // 22:30Z le 29 = 00:30 Paris le 30.
    expect(lastCloseDay(new Date("2026-03-29T22:30:00.000Z"))).toBe(
      "2026-03-29"
    );
    // 22:45Z le 29 = 00:45 Paris le 30.
    expect(lastCloseDay(new Date("2026-03-29T22:45:00.000Z"))).toBe(
      "2026-03-29"
    );
    // 23:30Z le 29 = 01:30 Paris le 30 : hors fenêtre fautive, déjà correct.
    expect(lastCloseDay(new Date("2026-03-30T00:30:00+01:00"))).toBe(
      "2026-03-29"
    );
    // Juste avant la fenêtre : 21:45Z le 29 = 23:45 Paris le 29.
    expect(lastCloseDay(new Date("2026-03-29T21:45:00.000Z"))).toBe(
      "2026-03-28"
    );
  });

  it("recul du 25 octobre 2026 : le soir du 25 ne rend jamais le 25", () => {
    // Le 25/10 dure 25 h. Entre 23 h et 24 h Paris, `now − 24 h` restait dans
    // le 25 : la fonction rendait la journée en cours.
    // 22:00Z le 25 = 23:00 Paris le 25 (GMT+1).
    expect(lastCloseDay(new Date("2026-10-25T22:00:00.000Z"))).toBe(
      "2026-10-24"
    );
    // 22:30Z le 25 = 23:30 Paris le 25.
    expect(lastCloseDay(new Date("2026-10-25T22:30:00.000Z"))).toBe(
      "2026-10-24"
    );
    // 22:45Z le 25 = 23:45 Paris le 25.
    expect(lastCloseDay(new Date("2026-10-25T22:45:00.000Z"))).toBe(
      "2026-10-24"
    );
    // Minuit franchi : 23:00Z le 25 = 00:00 Paris le 26.
    expect(lastCloseDay(new Date("2026-10-25T23:00:00.000Z"))).toBe(
      "2026-10-25"
    );
  });

  it("balayage au quart d'heure : jamais le jour en cours, toujours son précédent", () => {
    // Invariant, sur les deux bascules : la clôture est exactement le jour
    // civil parisien qui précède celui de `now`.
    const fenetres = [
      Date.parse("2026-03-27T20:00:00.000Z"), // avance du 29/03
      Date.parse("2026-10-23T20:00:00.000Z"), // recul du 25/10
    ];
    for (const debut of fenetres) {
      for (let m = 0; m <= 96 * 60; m += 15) {
        const now = new Date(debut + m * 60_000);
        const jourCourant = parisDayKey(now);
        const cloture = lastCloseDay(now);
        expect(cloture).toBe(previousDay(jourCourant));
        expect(cloture < jourCourant).toBe(true);
      }
    }
  });
});

describe("pas hebdomadaire borné à la dernière clôture", () => {
  const now = new Date("2026-09-07T11:00:00.000Z");

  it("le dernier point est au plus tard la clôture, jamais le jour en cours", () => {
    // `lastCloseDay(now)` (2026-09-06) est un dimanche : le pas hebdomadaire
    // n'émet plus sur ce jour (D26 — il n'a jamais de cotation). Le dernier
    // point servi est donc le dernier vendredi ≤ cette clôture, ici le 4.
    const jours = seriesEmissionDays(
      historyFloorDay(now),
      lastCloseDay(now),
      "week"
    );
    const dernier = jours[jours.length - 1]!;
    expect(dernier).toBe("2026-09-04");
    expect(jours).not.toContain("2026-09-07");
  });

  it("aucun point émis ne dépasse la clôture", () => {
    const borne = lastCloseDay(now);
    const jours = seriesEmissionDays(historyFloorDay(now), borne, "week");
    expect(jours.every((j) => j <= borne)).toBe(true);
  });

  it("au pas quotidien, sept jours font sept clôtures", () => {
    // 7J compte des journées closes, pas six closes et un jour entamé.
    const jours = seriesEmissionDays("2026-08-31", "2026-09-06", "day");
    expect(jours).toHaveLength(7);
    expect(jours[jours.length - 1]).toBe("2026-09-06");
  });
});

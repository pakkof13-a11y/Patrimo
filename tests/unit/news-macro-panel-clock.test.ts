import { describe, expect, it } from "vitest";
import { dayAnchor } from "@/components/dashboard/news-macro-panel";
import { parisDayOf, parisEventClock } from "@/app/lib/ui/paris-clock";

/*
  La cellule d'heure des cartes Macro/Résultats était en largeur fixe (`w-10`,
  2,5rem) et débordait sur le drapeau/logo dès que `parisEventClock` rendait
  la forme longue (jour + heure) — systématique depuis que la barre de jours
  permet de sélectionner n'importe quel jour de la fenêtre, puisqu'alors
  « aujourd'hui » (la référence implicite de `parisEventClock`) diffère du
  jour affiché sur *toutes* les lignes, pas seulement certaines.

  La correction ne retire pas le jour : elle change la référence passée à
  `parisEventClock`, de « l'instant réel » à « le jour sélectionné dans la
  barre » (`dayAnchor`). Comme `macroDayEvents`/`earnDayEvents` filtrent déjà
  chaque liste sur ce même jour, toute ligne réellement affichée par le
  panneau a par construction le même jour que son ancre — la forme courte
  suffit, le jour restant porté par l'onglet actif de la barre (toujours
  rendue au-dessus de la liste).
*/

describe("dayAnchor (news-macro-panel)", () => {
  it("retombe sur le jour civil demandé, à Paris", () => {
    expect(parisDayOf(dayAnchor("2026-09-08"))).toBe("2026-09-08");
    expect(parisDayOf(dayAnchor("2026-01-01"))).toBe("2026-01-01");
  });

  it("fait lire à parisEventClock une ligne dont le jour réel diffère de « aujourd'hui » comme le jour sélectionné", () => {
    // Relevé du flux (paris-clock.test.ts) : 2026-09-07T18:45:00-04:00 tombe
    // le 2026-09-08 à Paris, pas le jour de l'instant réel ci-dessous.
    const NZ_BRUT = "2026-09-07T18:45:00-04:00";
    const instantReel = new Date("2026-09-07T11:00:00.000Z"); // le 7, 13h Paris

    // Sans l'ancre de jour (référence = l'instant réel) : forme longue, le
    // jour de la ligne (8) diffère du jour réel (7).
    const sansAncre = parisEventClock(NZ_BRUT, instantReel);
    expect(sansAncre).toMatch(/8/);
    expect(sansAncre).not.toBe("00:45");

    // Avec l'ancre posée sur le jour sélectionné dans la barre (8, celui de
    // la ligne — c'est la garantie apportée par le filtrage
    // macroDayEvents/earnDayEvents) : forme courte, plus de redondance.
    const avecAncre = parisEventClock(NZ_BRUT, dayAnchor("2026-09-08"));
    expect(avecAncre).toBe("00:45");
  });

  it("retombe sur la forme longue si le jour de la ligne diffère malgré tout de l'ancre — filet de sécurité, pas le chemin attendu", () => {
    const NZ_BRUT = "2026-09-07T18:45:00-04:00"; // le 8 à Paris
    const rendu = parisEventClock(NZ_BRUT, dayAnchor("2026-09-01"));
    expect(rendu).not.toBe("00:45");
    expect(rendu).toMatch(/8/);
  });

  it("ne fabrique pas de jour sur une clé illisible", () => {
    expect(parisDayOf(dayAnchor(""))).toBeNull();
    expect(parisDayOf(dayAnchor("pas-une-date"))).toBeNull();
  });
});

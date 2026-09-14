import { describe, expect, it } from "vitest";
import {
  parisDayOf,
  parisEventClock,
} from "@/app/lib/ui/paris-clock";

/*
  L'heure affichée d'un événement de marché.

  L'hypothèse de départ était une double conversion de fuseau. Mesuré sur la
  source, elle ne tient pas : `ff_calendar_thisweek.json` date ses lignes avec
  un décalage explicite, et `new Date` les lit sans ambiguïté. Le cas
  néo-zélandais ci-dessous est copié tel quel du flux.

  Ce qui manquait était le **jour**. Une heure seule, lue en milieu de journée,
  se rapporte naturellement à aujourd'hui — et un événement du lendemain
  paraissait déjà passé alors qu'il était correctement classé « à venir ».
*/

/** Ligne réelle du flux, relevée le 7 septembre 2026. */
const NZ_BRUT = "2026-09-07T18:45:00-04:00";
const LE_7_A_13H_PARIS = new Date("2026-09-07T11:00:00.000Z");

describe("parisEventClock", () => {
  it("lit le décalage de la source plutôt que de le supposer", () => {
    // 18:45 à -04:00 = 22:45 UTC = 00:45 à Paris, le lendemain.
    expect(new Date(NZ_BRUT).toISOString()).toBe("2026-09-07T22:45:00.000Z");
    expect(parisDayOf(NZ_BRUT)).toBe("2026-09-08");
  });

  it("porte le jour quand l'événement n'est pas d'aujourd'hui", () => {
    const rendu = parisEventClock(NZ_BRUT, LE_7_A_13H_PARIS);
    expect(rendu).toMatch(/00:45/);
    // Sans le jour, « 00:45 » se lisait comme une heure déjà passée.
    expect(rendu).not.toBe("00:45");
    expect(rendu).toMatch(/8/);
  });

  it("s'en tient à l'heure quand l'événement est du jour", () => {
    // 17:30 Paris le 7, vu le 7 : le jour n'apporte rien.
    expect(
      parisEventClock("2026-09-07T15:30:00.000Z", LE_7_A_13H_PARIS)
    ).toBe("17:30");
  });

  it("rend un tiret sur une date illisible plutôt qu'une heure inventée", () => {
    // UNKNOWN ≠ une heure plausible : fausse, elle serait indiscernable.
    expect(parisEventClock("pas une date", LE_7_A_13H_PARIS)).toBe("—");
    expect(parisDayOf("pas une date")).toBeNull();
  });

  it("le jour civil est celui de Paris, pas celui d'UTC", () => {
    // 23:30 UTC le 7 = 01:30 le 8 à Paris (heure d'été).
    expect(parisDayOf("2026-09-07T23:30:00.000Z")).toBe("2026-09-08");
    // 00:30 UTC le 8 = 02:30 le 8 à Paris — même jour, sans bascule.
    expect(parisDayOf("2026-09-08T00:30:00.000Z")).toBe("2026-09-08");
  });
});

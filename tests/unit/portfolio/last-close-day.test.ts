import { describe, expect, it } from "vitest";
import {
  historyFloorDay,
  lastCloseDay,
  seriesEmissionDays,
} from "@/app/lib/portfolio/historical/history-window";

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

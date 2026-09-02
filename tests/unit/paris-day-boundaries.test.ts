import { describe, expect, it } from "vitest";
import {
  endOfParisDay,
  parisDayKey,
  parisDayStart,
} from "@/app/lib/dates/paris";

/**
 * Frontières de la journée civile parisienne.
 *
 * C'est la convention retenue pour l'historique du portefeuille : une valeur
 * « au 3 août » se lit à 00 h 00 heure de Paris. Découper à minuit UTC ferait
 * basculer dans la veille tout relevé pris entre minuit et 2 h du matin en
 * été — c'est précisément ce que faisait l'enregistrement des snapshots.
 */
describe("journée civile Europe/Paris", () => {
  it("commence à 22 h UTC en été, 23 h UTC en hiver", () => {
    // Heure d'été : UTC+2 → 00 h 00 Paris = 22 h 00 UTC la veille.
    expect(parisDayStart("2026-08-02").toISOString()).toBe(
      "2026-08-01T22:00:00.000Z"
    );
    // Heure d'hiver : UTC+1 → 23 h 00 UTC la veille.
    expect(parisDayStart("2026-01-15").toISOString()).toBe(
      "2026-01-14T23:00:00.000Z"
    );
  });

  it("se ferme la milliseconde avant le jour suivant", () => {
    expect(endOfParisDay("2026-08-02").toISOString()).toBe(
      "2026-08-02T21:59:59.999Z"
    );
    expect(endOfParisDay("2026-01-15").toISOString()).toBe(
      "2026-01-15T22:59:59.999Z"
    );
  });

  it("gère les journées de 23 h et de 25 h des changements d'heure", () => {
    const duree = (day: string) =>
      (endOfParisDay(day).getTime() - parisDayStart(day).getTime() + 1) /
      3_600_000;

    // Dernier dimanche de mars : on avance d'une heure, la journée en perd une.
    expect(duree("2026-03-29")).toBe(23);
    // Dernier dimanche d'octobre : on recule, la journée en gagne une.
    expect(duree("2026-10-25")).toBe(25);
    expect(duree("2026-08-02")).toBe(24);
  });

  it("reste dans son propre jour, aux deux extrémités", () => {
    for (const day of ["2026-03-29", "2026-10-25", "2026-01-01", "2026-12-31"]) {
      expect(parisDayKey(parisDayStart(day))).toBe(day);
      expect(parisDayKey(endOfParisDay(day))).toBe(day);
    }
  });

  it("rend une date invalide plutôt qu'une frontière inventée", () => {
    expect(Number.isNaN(parisDayStart("pas-une-date").getTime())).toBe(true);
    expect(Number.isNaN(endOfParisDay("").getTime())).toBe(true);
  });

  it("tient la profondeur d'une série historique sans s'effondrer", () => {
    /*
      Ces fonctions sont appelées une fois par jour civil sur toute la
      profondeur du portefeuille — plus de dix mille appels par série. Chacune
      construisait auparavant ses propres formateurs `Intl` : le coût unitaire,
      négligeable, devenait plusieurs secondes de boucle d'événements bloquée,
      jusqu'à faire tomber des requêtes concurrentes.

      Le budget est large — on garde une régression d'un ordre de grandeur, pas
      une variation de machine.
    */
    const debut = Date.now();
    for (let i = 0; i < 10_000; i++) {
      endOfParisDay(
        new Date(Date.UTC(2000, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
      );
    }
    expect(Date.now() - debut).toBeLessThan(2_000);
  });
});

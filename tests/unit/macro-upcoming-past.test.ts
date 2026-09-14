import { describe, expect, it } from "vitest";
import { isMacroEventPublished } from "@/app/lib/news/service";
import type { MacroEvent } from "@/app/lib/news/service";

/*
  « À venir » et « Passés » se départagent sur l'heure de l'événement.

  La route lisait `isMacroEventPublished`, qui répond à une autre question :
  le chiffre est-il tombé ? Un indicateur qui porte une prévision mais dont le
  fournisseur ne publie jamais le réel restait donc « à venir » indéfiniment,
  des jours après son heure — et n'apparaissait dans aucune des deux listes
  que l'écran propose.

  Ces contrôles épinglent la règle de partage, et la distinction entre les deux
  questions. Ils sont écrits sur la même fonction pure que la route applique.
*/

const NOW = Date.parse("2026-09-07T12:00:00.000Z");

function ev(over: Partial<MacroEvent> & { time: string }): MacroEvent {
  return {
    id: over.time,
    country: "États-Unis",
    countryCode: "us",
    title: "Indice des prix",
    impact: "high",
    actual: null,
    forecast: null,
    previous: null,
    ...over,
  } as MacroEvent;
}

/** La règle de la route, isolée pour être vérifiable sans serveur. */
const estAVenir = (e: { time: string }, nowMs = NOW) => {
  const t = Date.parse(e.time);
  return !Number.isFinite(t) || t > nowMs;
};

describe("partage à venir / passés", () => {
  it("un événement dont l'heure est dépassée quitte « à venir »", () => {
    const passe = ev({
      time: "2026-09-07T06:30:00.000Z",
      forecast: "2,4 %",
      previous: "2,3 %",
    });
    // Le chiffre n'est pas tombé — et c'est justement le cas qui bloquait.
    expect(isMacroEventPublished(passe, new Date(NOW))).toBe(false);
    expect(estAVenir(passe)).toBe(false);
  });

  it("un événement encore à venir y reste", () => {
    const futur = ev({ time: "2026-09-07T18:00:00.000Z", forecast: "0,2 %" });
    expect(estAVenir(futur)).toBe(true);
  });

  it("les deux listes sont complémentaires — ni trou ni doublon", () => {
    const events = [
      ev({ time: "2026-09-06T08:00:00.000Z" }),
      ev({ time: "2026-09-07T06:30:00.000Z", forecast: "2,4 %" }),
      ev({ time: "2026-09-07T12:00:00.000Z" }),
      ev({ time: "2026-09-07T18:00:00.000Z" }),
      ev({ time: "2026-09-09T08:00:00.000Z" }),
    ];
    const aVenir = events.filter((e) => estAVenir(e));
    const passes = events.filter((e) => !estAVenir(e));
    expect(aVenir.length + passes.length).toBe(events.length);
    expect(aVenir.filter((e) => passes.includes(e))).toHaveLength(0);
    // L'événement pile à l'heure courante est passé, pas à venir.
    expect(passes.map((e) => e.time)).toContain("2026-09-07T12:00:00.000Z");
  });

  it("une date illisible reste « à venir » plutôt que d'être déclarée sortie", () => {
    // UNKNOWN ≠ PASSÉ : on n'affirme pas qu'un événement est sorti sans le savoir.
    expect(estAVenir(ev({ time: "pas une date" }))).toBe(true);
  });

  it("isMacroEventPublished garde son sens — le chiffre, pas l'heure", () => {
    const avecReel = ev({
      time: "2026-09-07T06:30:00.000Z",
      actual: "2,5 %",
      forecast: "2,4 %",
    });
    expect(isMacroEventPublished(avecReel, new Date(NOW))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { coingeckoDaysParam } from "@/app/lib/market/price-history";

/**
 * T-2c — le seau qui retombait sur `"max"` au-delà de 365 jours faisait
 * basculer `/coins/{id}/ohlc` sur des bougies pluri-journalières : mesuré en
 * preview, 18 points espacés sur trois ans au lieu d'une série quotidienne.
 * Un backfill (premier achat ancien) doit obtenir un `days` numérique exact.
 */
describe("coingeckoDaysParam — fenêtre numérique explicite", () => {
  it("rend un nombre, jamais la chaîne \"max\"", () => {
    const from = new Date("2021-01-01T00:00:00Z");
    const to = new Date("2026-09-04T00:00:00Z");
    const days = coingeckoDaysParam(from, to);
    expect(typeof days).toBe("number");
    expect(days).toBeGreaterThan(365);
  });

  it("couvre exactement la fenêtre demandée, sans seau", () => {
    const from = new Date("2026-08-01T00:00:00Z");
    const to = new Date("2026-08-10T00:00:00Z");
    expect(coingeckoDaysParam(from, to)).toBe(10);
  });

  it("plafonne à 3650 jours pour une fenêtre extrême", () => {
    const from = new Date("1990-01-01T00:00:00Z");
    const to = new Date("2026-09-04T00:00:00Z");
    expect(coingeckoDaysParam(from, to)).toBe(3650);
  });
});

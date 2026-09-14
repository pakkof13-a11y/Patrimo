import { describe, it, expect } from "vitest";
import { isFrSource } from "@/app/lib/news/news-live";

/**
 * Bonus de source FR (P5, D23).
 *
 * Les étiquettes ci-dessous sont celles réellement rendues par Google News RSS
 * (hl=fr&gl=FR), mesurées sur le flux — pas des noms de domaine ni des noms
 * de marque supposés.
 */
describe("isFrSource", () => {
  it("reconnaît BFM sous ses deux étiquettes réelles", () => {
    // Mesuré : Google News rend « BFM » et « BFM Bourse », jamais « bfmtv »
    // ni « bfmbusiness » — ces deux derniers ne matchaient jamais.
    expect(isFrSource("BFM")).toBe(true);
    expect(isFrSource("BFM Bourse")).toBe(true);
  });

  it("reconnaît les nouvelles sources ajoutées", () => {
    expect(isFrSource("L'Agefi")).toBe(true);
    expect(isFrSource("L'Usine Nouvelle")).toBe(true);
    expect(isFrSource("Investing.com France")).toBe(true);
    expect(isFrSource("Le Monde.fr")).toBe(true);
    expect(isFrSource("Le Figaro")).toBe(true);
    expect(isFrSource("Le Figaro Bourse")).toBe(true);
  });

  it("ne boost pas une édition non française d'Investing.com", () => {
    // hl=fr&gl=FR rend systématiquement « Investing.com France » (mesuré) ;
    // le bonus ne cible que cette étiquette, pas un « Investing.com » nu qui
    // désignerait l'édition anglophone.
    expect(isFrSource("Investing.com")).toBe(false);
  });

  it("ne boost aucune source non française", () => {
    expect(isFrSource("Bloomberg")).toBe(false);
    expect(isFrSource("CNBC")).toBe(false);
    expect(isFrSource("Wall Street Journal")).toBe(false);
    expect(isFrSource("Reuters")).toBe(true); // déjà listé (FR via Google News FR)
  });
});

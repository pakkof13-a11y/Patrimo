import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_PRESETS,
  supportsMultipleEnvelopes,
} from "@/app/lib/platforms/presets";
import { IMPORT_FORMATS } from "@/app/lib/import/presets";

/**
 * Enveloppe fiscale à l'import CSV.
 *
 * Un courtier français ouvre indifféremment un PEA ou un compte-titres, et
 * aucun export ne dit lequel : la question doit être posée. Le sélecteur
 * existait mais sa condition d'affichage comparait l'identifiant de la
 * plateforme en base à des clés du catalogue — deux ensembles disjoints. Il
 * n'apparaissait donc jamais, et tout import atterrissait en CTO.
 */

describe("plateformes multi-enveloppes", () => {
  it("les courtiers titres posent la question", () => {
    for (const key of [
      "INTERACTIVE_BROKERS",
      "BOURSE_DIRECT",
      "BOURSOBANK",
      "FORTUNEO",
      "SAXO_BANK",
      "DEGIRO",
      "TRADE_REPUBLIC",
      "DIRECTA",
    ]) {
      expect(supportsMultipleEnvelopes(key), key).toBe(true);
    }
  });

  it("Bourse Direct et Saxo ne sont plus oubliés", () => {
    // La liste figée qu'on remplace n'en contenait que cinq ; le catalogue
    // suit désormais les ajouts de plateformes sans qu'on y pense.
    expect(supportsMultipleEnvelopes("BOURSE_DIRECT")).toBe(true);
    expect(supportsMultipleEnvelopes("SAXO_BANK")).toBe(true);
  });

  it("une plateforme mono-enveloppe ne pose pas de choix inutile", () => {
    /*
      Un exchange crypto, un wallet matériel ou une banque de dépôt n'ont
      qu'une façon de détenir : leur demander PEA ou CTO n'aurait pas de sens.
    */
    for (const key of [
      "BINANCE",
      "COINBASE",
      "KRAKEN",
      "CRYPTO_COM",
      "BITVAVO",
      "LEDGER",
      "TREZOR",
      "RABOBANK",
    ]) {
      expect(supportsMultipleEnvelopes(key), key).toBe(false);
    }
  });

  it("eToro pose la question — CTO et CFD y coexistent", () => {
    expect(supportsMultipleEnvelopes("ETORO")).toBe(true);
  });

  it("une plateforme inconnue ou absente ne déclenche rien", () => {
    expect(supportsMultipleEnvelopes(null)).toBe(false);
    expect(supportsMultipleEnvelopes("")).toBe(false);
    expect(supportsMultipleEnvelopes("   ")).toBe(false);
  });

  it("le prédicat s'appuie sur le catalogue, pas sur une liste figée", () => {
    // Toute plateforme catalogue déclarée courtier ou assureur doit répondre
    // oui : c'est ce qui garantit qu'un ajout futur est couvert d'office.
    for (const p of PLATFORM_PRESETS) {
      const attendu = p.types.some(
        (t) => t === "COURTIER" || t === "ASSURANCE_VIE" || t === "BROKER_CFD"
      );
      expect(supportsMultipleEnvelopes(p.key), p.key).toBe(attendu);
    }
  });
});

describe("condition d'affichage du sélecteur", () => {
  const modal = readFileSync(
    "components/modals/import-csv-modal.tsx",
    "utf8"
  );

  it("le sélecteur est conditionné à la clé catalogue, pas à l'id en base", () => {
    /*
      `platformId` est un identifiant de ligne en base ; les clés catalogue
      (« INTERACTIVE_BROKERS »…) n'y figurent jamais. Comparer les deux rendait
      le sélecteur inatteignable, sans qu'aucune erreur ne le signale.
    */
    expect(modal).toContain(
      "supportsMultipleEnvelopes(selectedPlatformKey)"
    );
    expect(modal).not.toMatch(
      /\[\s*"INTERACTIVE_BROKERS",[\s\S]{0,200}\]\.includes\(platformId\)/
    );
  });

  it("le choix est transmis à l'API d'import", () => {
    expect(modal).toContain("accountEnvelopeType:");
    expect(modal).toContain('data-testid="import-account-envelope"');
  });

  it("les quatre enveloppes restent proposées", () => {
    for (const v of ["CTO", "PEA", "AV", "CFD"]) {
      expect(modal).toContain(`<option value="${v}">`);
    }
  });
});

describe("l'enveloppe n'est identifiable dans aucun export", () => {
  it("aucun format d'import ne colonne l'enveloppe fiscale", () => {
    /*
      C'est ce qui rend la question nécessaire : si un export la portait, il
      faudrait la lire plutôt que la demander. Ce test le fige — le jour où un
      format apporte la colonne, il faudra rendre le sélecteur facultatif.
    */
    for (const f of IMPORT_FORMATS) {
      for (const [colonne, role] of Object.entries(f.aliases)) {
        expect(
          /envelope|enveloppe|account_type|pea/i.test(colonne) &&
            role !== "ignore",
          `${f.id}.${colonne}`
        ).toBe(false);
      }
    }
  });
});

describe("transmission jusqu'à l'import", () => {
  const route = readFileSync("app/api/import/commit/route.ts", "utf8");
  const commit = readFileSync("app/lib/import/commit.ts", "utf8");

  it("la route relaie l'enveloppe au commit", () => {
    expect(route).toContain("body?.accountEnvelopeType");
    expect(route).toContain("accountEnvelopeType: accountEnvelopeType");
  });

  it("le commit l'applique à la résolution de chaque actif", () => {
    expect(commit).toContain("params.accountEnvelopeType");
    // `overrideAccountType` l'emporte sur la classe déduite : c'est ce qui
    // fait qu'un import PEA crée bien des actifs PEA.
    expect(commit).toContain("overrideAccountType ||");
  });
});

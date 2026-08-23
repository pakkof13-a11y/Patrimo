import { describe, it, expect } from "vitest";
import {
  ENVELOPE_LABELS,
  envelopeLabel,
  type EnvelopeType,
} from "@/app/lib/terminology";
import { envelopeLabel as envelopeLabelFromPlatforms } from "@/app/lib/platforms/connection";
import { ACCOUNT_TYPES, PLATFORM_TYPES } from "@/app/lib/constants";

/**
 * Vocabulaire patrimonial.
 *
 * Le défaut corrigé : « compte » et « enveloppe » désignaient la même chose
 * selon l'écran, et `envelopeLabel` existait en double. Ces tests verrouillent
 * la propriété qui compte — **une seule définition de l'enveloppe** — plutôt
 * que d'énumérer des chaînes d'interface.
 */

describe("glossaire", () => {
  it("l'enveloppe n'a qu'une définition dans toute l'application", () => {
    /*
      `platforms/connection.ts` portait sa propre copie. Deux définitions d'un
      même libellé divergent à la première enveloppe ajoutée.
    */
    for (const key of Object.keys(ENVELOPE_LABELS) as EnvelopeType[]) {
      expect(envelopeLabelFromPlatforms(key)).toBe(envelopeLabel(key));
    }
  });

  it("ENVELOPE_LABELS est un alias de ACCOUNT_TYPES, pas une seconde table", () => {
    /*
      Le nom `ACCOUNT_TYPES` est historique et trompeur : il contient des
      enveloppes fiscales. On lui donne un nom juste sans dupliquer la donnée —
      deux tables auraient fini par diverger.
    */
    expect(ENVELOPE_LABELS).toBe(ACCOUNT_TYPES);
  });

  it("les enveloppes sont bien des cadres fiscaux, pas des plateformes", () => {
    /*
      Garde-fou contre le glissement que le chantier corrige : une enveloppe
      répond à « dans quel cadre ? », une plateforme à « d'où vient la
      donnée ? ». Les deux ensembles ne doivent partager aucune clé.
    */
    const envelopes = Object.keys(ENVELOPE_LABELS);
    const platforms = Object.keys(PLATFORM_TYPES);
    expect(envelopes).toContain("PEA");
    expect(envelopes).toContain("CTO");
    expect(platforms).toContain("BANQUE");
    expect(envelopes.filter((e) => platforms.includes(e))).toEqual([]);
  });

  it("une enveloppe inconnue retombe sur sa clé, jamais sur un libellé inventé", () => {
    expect(envelopeLabel("INEXISTANT")).toBe("INEXISTANT");
  });
});

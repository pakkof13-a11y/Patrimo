import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PORTFOLIO_VIEW_QUERY_KEYS } from "@/app/lib/ui/invalidate-portfolio";

/**
 * Le câblage du rafraîchissement du module DeFi.
 *
 * Contrôle de source, faute de rendu React dans cette suite : le défaut à
 * prévenir est un maillon débranché — une mutation qui écrit en base et laisse
 * l'écran sur son état d'avant. Un test de comportement ne le verrait pas, il
 * faudrait monter le panneau.
 *
 * Deux choses sont épinglées, et pas l'implémentation autour :
 *   1. la clé que lit la liste (`crypto-defi-portfolio`) est bien invalidée par
 *      les mutations qui ajoutent ou retirent une ligne ;
 *   2. ces mutations écrivent au journal (`createTransaction` dans
 *      `defi-manual-service`), donc elles passent par la fonction unique qui
 *      connaît les requêtes de la vue patrimoniale, au lieu d'en énumérer une
 *      liste qui dérive — c'est ainsi que `["portfolio"]`, lue par aucune
 *      requête, avait survécu à côté d'un `transactions` manquant.
 */
const source = (chemin: string) =>
  readFileSync(resolve(process.cwd(), chemin), "utf8");

const PANNEAU = "components/crypto/defi-panel.tsx";
const FORMULAIRE = "components/crypto/defi/defi-position-form.tsx";
const DETAIL = "components/crypto/defi/defi-detail-panel.tsx";

/** La clé de la requête qui alimente le tableau des positions. */
const CLE_LISTE = "crypto-defi-portfolio";

describe("la liste DeFi se rafraîchit après une mutation", () => {
  it("le tableau est alimenté par la requête `crypto-defi-portfolio`", () => {
    // Si cette clé est renommée, les invalidations ci-dessous deviennent
    // muettes sans qu'aucun appel ne change : on l'ancre donc ici.
    expect(source(PANNEAU)).toContain(`queryKey: ["${CLE_LISTE}"]`);
  });

  it("la création invalide la clé que lit la liste", () => {
    expect(source(FORMULAIRE)).toContain(`invalidateQueries({ queryKey: ["${CLE_LISTE}"] })`);
  });

  it("la clôture invalide la clé que lit la liste", () => {
    expect(source(DETAIL)).toContain(`invalidateQueries({ queryKey: ["${CLE_LISTE}"] })`);
  });
});

describe("une position DeFi écrit au journal — la vue patrimoniale suit", () => {
  for (const fichier of [PANNEAU, FORMULAIRE, DETAIL]) {
    it(`${fichier} passe par invalidatePortfolioView`, () => {
      const code = source(fichier);
      expect(code).toContain("invalidatePortfolioView");
      expect(code).toContain("@/app/lib/ui/invalidate-portfolio");
    });

    it(`${fichier} n'invalide aucune clé de la vue patrimoniale à la main`, () => {
      /*
        Le panneau *lit* `["platforms"]` — c'est légitime. Ce qui ne l'est pas,
        c'est de la réénumérer au moment d'invalider : la liste divergerait de
        nouveau. La vérification porte donc sur les sites d'invalidation.
      */
      const code = source(fichier);
      for (const [cle] of PORTFOLIO_VIEW_QUERY_KEYS) {
        expect(code).not.toContain(`invalidateQueries({ queryKey: ["${cle}"] })`);
      }
    });

    it(`${fichier} ne nomme plus la clé morte "portfolio"`, () => {
      // Aucune requête ne lit `["portfolio"]` : l'invalider ne rafraîchissait
      // rien et laissait croire que l'écran était couvert.
      expect(source(fichier)).not.toContain(
        'invalidateQueries({ queryKey: ["portfolio"] })'
      );
    });
  }
});

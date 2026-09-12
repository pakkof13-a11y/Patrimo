import { describe, expect, it } from "vitest";
import { fullMonthsBetween, contractAge } from "@/app/lib/life-insurance/fiscal";
import { assetClassForSupport } from "@/app/lib/life-insurance/migrate-to-ledger";
import { isEuroFundName } from "@/app/lib/life-insurance/reconcile";
import { assetClassForKind } from "@/app/lib/life-insurance/constants";
import {
  clampGainsOverride,
  gainsInPartialRedemption,
} from "@/app/lib/life-insurance/redemption-tax";

/**
 * Trois règles pures de l'assurance-vie : le plafond d'un rachat, le jour
 * calendaire de l'antériorité, et l'unicité de la règle « fonds euro ».
 *
 * Elles se vérifient sans base, d'où leur cohabitation. Le fichier s'appelait
 * `performance-total-derive` et ne testait ni le total consolidé ni sa
 * dérivation : ceux-là vivent dans `performance-orphan-support`, et la quantité
 * de réévaluation dans `revalue-support`.
 *
 * Le jour calendaire est celui d'Europe/Paris, pas UTC — voir `fiscal.ts`.
 */

/* ── ④ le plafond de rachat ─────────────────────────────────────────── */

describe("gainsInPartialRedemption — plafond", () => {
  const position = { positionValueEur: "100000", costBasisEur: "80000" };

  it("un rachat partiel ordinaire passe et rend le montant plafonné", () => {
    const r = gainsInPartialRedemption({ redemptionEur: "50000", ...position });
    expect(r.ok).toBe(true);
    // `formatMoney` ne pose pas de décimales inutiles.
    expect(r.cappedRedemptionEur).toBe("50000");
    // 20 000 de gain latent sur 100 000 → 20 % du rachat.
    expect(Number(r.gainsInRedemptionEur)).toBeCloseTo(10_000, 2);
  });

  /*
    La mesure. Position à 100 000 € (revient 80 000), saisie de 200 000 €.

    Avant : les gains étaient plafonnés au gain latent, la fonction répondait
    `ok: true`, et le panneau calculait l'impôt puis le net sur les 200 000 €
    saisis — « net perçu 195 060 € » pour un contrat qui détient 100 000 €.
  */
  it("refuse un rachat supérieur à l'encours, au lieu de rogner en silence", () => {
    const r = gainsInPartialRedemption({ redemptionEur: "200000", ...position });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/supérieur à l'encours/i);
    // Et il dit jusqu'où on pouvait aller.
    expect(r.cappedRedemptionEur).toBe("100000");
    // Aucune quote-part de gains n'est proposée sur une saisie refusée.
    expect(r.gainsInRedemptionEur).toBe("0");
  });

  it("un rachat total exact reste accepté", () => {
    const r = gainsInPartialRedemption({ redemptionEur: "100000", ...position });
    expect(r.ok).toBe(true);
    // Sortie complète : tout le gain latent est imposable.
    expect(Number(r.gainsInRedemptionEur)).toBeCloseTo(20_000, 2);
  });

  it("un refus pour montant négatif rend un plafond « 0 » qui n'en est pas un", () => {
    // Ce zéro est un vide, pas un encours : l'appelant ne doit pas l'afficher
    // comme maximum rachetable (le panneau ne l'affiche que s'il est > 0).
    const r = gainsInPartialRedemption({
      redemptionEur: "1000",
      positionValueEur: "-5",
      costBasisEur: "0",
    });
    expect(r.ok).toBe(false);
    expect(r.error).not.toMatch(/encours/i);
    expect(r.cappedRedemptionEur).toBe("0");
  });

  it("le gain latent reste rendu même sur un refus, pour l'affichage", () => {
    const r = gainsInPartialRedemption({ redemptionEur: "200000", ...position });
    expect(Number(r.latentGainEur)).toBeCloseTo(20_000, 2);
  });

  /*
    Le gain latent est une propriété de la position (valeur − revient), pas
    de la saisie. Les deux autres refus le rendaient à « 0 » : une saisie
    négative sur une position à 20 000 € de plus-value réaffichait « Gain
    latent 0 € » — le défaut corrigé sur la branche « > encours », par une
    autre porte. Même logique pour le ratio et le plafond : ils ne dépendent
    que de la position.
  */
  it("une saisie négative refuse le rachat sans effacer le gain latent", () => {
    const r = gainsInPartialRedemption({ redemptionEur: "-1", ...position });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/négatifs/i);
    expect(Number(r.latentGainEur)).toBeCloseTo(20_000, 2);
    expect(r.gainRatio).toBeCloseTo(0.2, 6);
    // Le maximum rachetable est l'encours, comme sur un refus pour dépassement.
    expect(r.cappedRedemptionEur).toBe("100000");
    // Ce qui dépend de la saisie, lui, reste vide.
    expect(r.gainsInRedemptionEur).toBe("0");
    expect(r.capitalInRedemptionEur).toBe("0");
  });

  it("une saisie illisible refuse le rachat sans effacer le gain latent", () => {
    const r = gainsInPartialRedemption({ redemptionEur: "abc", ...position });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalides/i);
    expect(Number(r.latentGainEur)).toBeCloseTo(20_000, 2);
    expect(r.gainRatio).toBeCloseTo(0.2, 6);
    expect(r.cappedRedemptionEur).toBe("100000");
    expect(r.gainsInRedemptionEur).toBe("0");
  });

  it("une position illisible est le seul cas où le gain latent est inconnu", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "1000",
      positionValueEur: "abc",
      costBasisEur: "80000",
    });
    expect(r.ok).toBe(false);
    expect(r.latentGainEur).toBe("0");
    expect(r.gainRatio).toBe(0);
    expect(r.cappedRedemptionEur).toBe("0");
  });

  it("une moins-value latente rend un gain latent nul sur refus, pas négatif", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "-1",
      positionValueEur: "70000",
      costBasisEur: "80000",
    });
    expect(r.ok).toBe(false);
    expect(r.latentGainEur).toBe("0");
    expect(r.gainRatio).toBe(0);
    expect(r.cappedRedemptionEur).toBe("70000");
  });

  /*
    Le libellé du refus ne nomme plus « le support » : la fonction reçoit une
    valeur qui peut être la somme de plusieurs supports (périmètre « Tout le
    contrat »), et désigner un support unique qui n'existe pas était trompeur
    — pas faux en montant, faux en objet.
  */
  it("le refus pour dépassement parle d'encours disponible, pas de support", () => {
    const r = gainsInPartialRedemption({ redemptionEur: "200000", ...position });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Rachat supérieur à l'encours disponible (100000 €)");
    expect(r.error).not.toMatch(/support/i);
  });
});

/* ── deux lignes : P&L signé et assiette imposable ─────────────────── */

describe("gainsInPartialRedemption — plus-value signée vs assiette", () => {
  /*
    La mesure. Position à 90 000 € pour 100 000 € de revient : « Gain latent »
    affichait 0 € (max(0, …)) là où la vue contrat dit −10 000 €, pour la même
    position. Les deux nombres sont rendus, sous deux noms.
  */
  it("en moins-value : P&L −10 000, assiette 0 — jamais négative", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "5000",
      positionValueEur: "90000",
      costBasisEur: "100000",
    });
    expect(r.ok).toBe(true);
    expect(r.latentPnlEur).toBe("-10000");
    expect(r.latentGainEur).toBe("0");
    expect(r.gainsInRedemptionEur).toBe("0");
  });

  it("en plus-value : les deux lignes coïncident", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "5000",
      positionValueEur: "100000",
      costBasisEur: "80000",
    });
    expect(r.latentPnlEur).toBe("20000");
    expect(r.latentGainEur).toBe("20000");
  });

  it("le P&L signé survit à un refus, comme l'assiette", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "-1",
      positionValueEur: "90000",
      costBasisEur: "100000",
    });
    expect(r.ok).toBe(false);
    expect(r.latentPnlEur).toBe("-10000");
    expect(r.latentGainEur).toBe("0");
  });

  it("position inconnue : P&L « 0 », pas un négatif inventé", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "1000",
      positionValueEur: "abc",
      costBasisEur: "100000",
    });
    expect(r.latentPnlEur).toBe("0");
  });
});

/* ── ⑤ le plafond d'une quote-part saisie à la main ────────────────── */

describe("clampGainsOverride — borné au gain latent, et dit lequel", () => {
  /*
    La mesure. Position à 100 000 € (revient 80 000 → 20 000 € de gain
    latent), rachat de 60 000 €, quote-part saisie « 50 000 ».

    Avant : le panneau bornait au seul rachat, 50 000 passait, et l'impôt
    portait sur 30 000 € de gains que le contrat ne détient pas — 7 410 € de
    trop (PS 17,2 % + PFU 7,5 % sur 30 000).
  */
  it("retient 20 000 (le gain latent), pas 50 000", () => {
    const c = clampGainsOverride({
      overrideEur: "50000",
      redemptionEur: 60000,
      latentGainEur: "20000",
    });
    expect(c.gainsEur).toBe("20000");
    expect(c.requestedEur).toBe("50000");
    expect(c.clampedBy).toBe("latentGain");
    expect(c.capEur).toBe("20000");
  });

  it("borne au rachat quand c'est lui le plus bas, et le nomme", () => {
    // Rachat 10 000 sur 20 000 de gain latent : la saisie 15 000 dépasse le
    // retrait lui-même.
    const c = clampGainsOverride({
      overrideEur: "15000",
      redemptionEur: "10000",
      latentGainEur: "20000",
    });
    expect(c.gainsEur).toBe("10000");
    expect(c.clampedBy).toBe("redemption");
    expect(c.capEur).toBe("10000");
  });

  it("laisse passer une saisie sous les deux bornes, sans signal", () => {
    const c = clampGainsOverride({
      overrideEur: "5000",
      redemptionEur: "60000",
      latentGainEur: "20000",
    });
    expect(c.gainsEur).toBe("5000");
    expect(c.clampedBy).toBe("none");
    expect(c.capEur).toBe("0");
  });

  it("encours inconnu (null) : seul le rachat borne — c'est le cas de l'override", () => {
    // Contrat sans support rattaché : le gain latent n'est pas « 0 », il est
    // inconnu. Le borner à 0 fermerait la saisie manuelle là où elle sert.
    const c = clampGainsOverride({
      overrideEur: "5000",
      redemptionEur: "10000",
      latentGainEur: null,
    });
    expect(c.gainsEur).toBe("5000");
    expect(c.clampedBy).toBe("none");
  });

  it("un gain latent connu et nul borne bien à 0", () => {
    const c = clampGainsOverride({
      overrideEur: "5000",
      redemptionEur: "10000",
      latentGainEur: "0",
    });
    expect(c.gainsEur).toBe("0");
    expect(c.clampedBy).toBe("latentGain");
  });

  it("une saisie négative ou illisible vaut 0, sans signal de plafond", () => {
    expect(clampGainsOverride({ overrideEur: "-3", redemptionEur: 10, latentGainEur: 5 }).gainsEur).toBe("0");
    const c = clampGainsOverride({ overrideEur: "abc", redemptionEur: 10, latentGainEur: 5 });
    expect(c.gainsEur).toBe("0");
    expect(c.clampedBy).toBe("none");
  });
});

/* ── ⑥ le jour calendaire, heure de Paris ──────────────────────────── */

describe("fullMonthsBetween — jour civil Europe/Paris", () => {
  /*
    La date d'ouverture est stockée à minuit UTC (`<input type="date">` →
    `new Date("2017-09-27")`). Les accesseurs locaux la lisaient la veille à
    l'ouest de Greenwich ; UTC réparait ce côté mais laissait `now` : le jour
    du fait générateur est le jour civil en France, et il commence à 22 h UTC
    en été (23 h en hiver). Les deux bornes passent donc par le jour Paris.
  */
  it("les huit ans s'acquièrent au jour dit, heure de Paris, pas la veille", () => {
    const ouverture = new Date("2017-09-27T00:00:00.000Z");

    // 21 h 59 UTC = 23 h 59 à Paris le 26 : toujours la veille.
    const veille = new Date("2025-09-26T21:59:00.000Z");
    expect(fullMonthsBetween(ouverture, veille)).toBe(95);
    expect(contractAge(ouverture, veille).hasAnteriority).toBe(false);

    // 22 h 00 UTC = minuit à Paris le 27 : le jour anniversaire a commencé.
    // (UTC dirait encore « 26 » : c'est le cas que cette règle tranche.)
    const minuitParis = new Date("2025-09-26T22:00:00.000Z");
    expect(fullMonthsBetween(ouverture, minuitParis)).toBe(96);
    expect(contractAge(ouverture, minuitParis).hasAnteriority).toBe(true);
  });

  it("la date stockée à 00:00Z tombe le même jour civil à Paris", () => {
    // 00:00Z = 01 h ou 02 h Paris, jamais la veille : le décodage ne dérive pas.
    const ouverture = new Date("2018-01-15T00:00:00.000Z");
    expect(
      fullMonthsBetween(ouverture, new Date("2026-01-15T00:00:00.000Z"))
    ).toBe(96);
    expect(
      fullMonthsBetween(ouverture, new Date("2026-01-14T22:59:00.000Z"))
    ).toBe(95);
  });

  it("un contrat ouvert un 31 garde sa date anniversaire", () => {
    const ouverture = new Date("2018-01-31T00:00:00.000Z");
    expect(
      fullMonthsBetween(ouverture, new Date("2018-02-28T12:00:00.000Z"))
    ).toBe(0);
    expect(
      fullMonthsBetween(ouverture, new Date("2018-03-31T12:00:00.000Z"))
    ).toBe(2);
    // Huit ans : le 31 janvier 2026, pas le 30.
    expect(
      contractAge(ouverture, new Date("2026-01-30T12:00:00.000Z")).hasAnteriority
    ).toBe(false);
    expect(
      contractAge(ouverture, new Date("2026-01-31T12:00:00.000Z")).hasAnteriority
    ).toBe(true);
  });

  it("un contrat ouvert un 29 février a huit ans le 29 février", () => {
    // Huit ans après une année bissextile tombe toujours sur une bissextile
    // (hors 2100) : l'anniversaire existe et le seuil est exact.
    const ouverture = new Date("2016-02-29T00:00:00.000Z");
    expect(
      contractAge(ouverture, new Date("2024-02-28T12:00:00.000Z")).hasAnteriority
    ).toBe(false);
    expect(
      contractAge(ouverture, new Date("2024-02-29T12:00:00.000Z")).hasAnteriority
    ).toBe(true);
  });

  it("une heure tardive ne fait pas basculer le mois avant minuit Paris", () => {
    // 21 h 59 UTC le 14 avril = 23 h 59 Paris : le jour vaut toujours 14.
    const ouverture = new Date("2017-03-15T00:00:00.000Z");
    expect(
      fullMonthsBetween(ouverture, new Date("2017-04-14T21:59:00.000Z"))
    ).toBe(0);
  });
});

/* ── ⑦ une seule règle « fonds euro » ───────────────────────────────── */

describe("assetClassForSupport — déduite du kind", () => {
  /*
    Deux règles cohabitaient sur la même question : `isEuroFundName` pour le
    `kind`, une expression plus étroite pour la classe d'actif. Un support
    « Sécurité Euro » repartait avec `kind = FONDS_EURO` et
    `assetClass = AUTRE` — le fonds à capital garanti atterrissait dans
    « Autre », et `kindFromAssetClass` le relisait ensuite comme une UC.
  */
  it.each([
    "Fonds euro Spirica",
    "Fonds en euros",
    "Sécurité Euro",
    "Eurocroissance",
  ])("« %s » est un fonds euro pour les deux règles", (nom) => {
    expect(isEuroFundName(nom)).toBe(true);
    expect(assetClassForSupport(nom)).toBe(assetClassForKind("FONDS_EURO"));
  });

  /*
    La règle unique doit aussi être étroite. La première unification avait
    propagé la plus large des deux règles (`\beuro(s)?\b`) à la classe d'actif :
    « Amundi Euro Equity » — une UC actions — repartait en OBLIGATIONS là où
    elle tombait en AUTRE auparavant. « Euro Exclusif » figurait ici parmi les
    fonds euro : c'est une marque, pas une dénomination, et la règle ne la
    devine plus — il part en UC, reclassable, et non en capital garanti.
  */
  it.each([
    "Amundi MSCI World",
    "Euro Stoxx 50",
    "Eurostoxx",
    "Amundi Euro Equity",
    "BNP Euro Small Cap",
    "Lyxor Euro Value",
    "Euro Exclusif",
  ])("« %s » reste une UC, classée AUTRE", (nom) => {
    expect(isEuroFundName(nom)).toBe(false);
    expect(assetClassForSupport(nom)).toBe(assetClassForKind("UC"));
    expect(assetClassForSupport(nom)).toBe("AUTRE");
  });

  it("les deux règles ne peuvent plus diverger", () => {
    // La classe se déduit du kind : il n'y a plus deux verdicts à accorder.
    for (const nom of [
      "Sécurité Euro",
      "Amundi World",
      "Fonds euro",
      "Amundi Euro Equity",
    ]) {
      const kind = isEuroFundName(nom) ? "FONDS_EURO" : "UC";
      expect(assetClassForSupport(nom)).toBe(assetClassForKind(kind));
    }
  });
});

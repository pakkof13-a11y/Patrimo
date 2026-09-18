/**
 * P2.1 — sous-titre faux quand Versus compare à un indice.
 *
 * `resolveEvolutionScopeSubtitle` porte le libellé de périmètre affiché sous
 * « Évolution du portefeuille ». Avant ce correctif, ce libellé dépendait de
 * `useDailyNavCurve` (`canUseDailyNavSeries && chartKind !== "percent"`), qui
 * devient `false` dès que Versus bascule sur « Indice » avec un overlay
 * valide — alors même que la NAV comparée reste celle du toggle
 * Net/Brut/Financier (`activeNavScope`), Versus ne faisant que la rebaser en
 * pourcentage (voir `vsIndexSeries` dans `portfolio-evolution-panel.tsx`).
 *
 * La fonction extraite ne prend `chartKind`/`versus` **en aucun paramètre** —
 * c'est la preuve structurelle du correctif : le sous-titre ne peut plus
 * varier selon Versus, seulement selon la disponibilité de la NAV
 * quotidienne (`canUseDailyNavSeries`) et le toggle de périmètre.
 *
 * Les quatre combinaisons couvertes : toggle (Net / Brut) × Versus (Aucun /
 * Indice). Les deux dernières se lisent en passant le même
 * `canUseDailyNavSeries: true` que produirait un Versus actif avec overlay —
 * exactement le scénario de la recette — et en vérifiant qu'il reste
 * identique au cas Versus éteint.
 */
import { describe, expect, it } from "vitest";
import { resolveEvolutionScopeSubtitle } from "@/components/dashboard/portfolio-evolution-panel";

describe("resolveEvolutionScopeSubtitle", () => {
  it("toggle Net, Versus Aucun : NAV quotidienne Net", () => {
    expect(
      resolveEvolutionScopeSubtitle({
        account: null,
        accountLabel: null,
        envelope: null,
        canUseDailyNavSeries: true,
        navScopeLabel: "Net",
      })
    ).toBe("Net — NAV quotidienne");
  });

  /*
    Le cœur du correctif : Versus actif (Indice, avec overlay) ne change ni
    `canUseDailyNavSeries` ni `navScopeLabel` côté composant — la NAV rebasée
    en % reste celle du toggle Net. Ce test rejoue ce même couple d'entrées
    et attend le même libellé que la ligne au-dessus, jamais « Actifs
    bruts ».
  */
  it("toggle Net, Versus Indice (overlay) : même libellé qu'avec Versus Aucun", () => {
    expect(
      resolveEvolutionScopeSubtitle({
        account: null,
        accountLabel: null,
        envelope: null,
        canUseDailyNavSeries: true,
        navScopeLabel: "Net",
      })
    ).toBe("Net — NAV quotidienne");
  });

  it("toggle Brut, Versus Aucun : NAV quotidienne Brut", () => {
    expect(
      resolveEvolutionScopeSubtitle({
        account: null,
        accountLabel: null,
        envelope: null,
        canUseDailyNavSeries: true,
        navScopeLabel: "Brut",
      })
    ).toBe("Brut — NAV quotidienne");
  });

  it("toggle Brut, Versus Indice (overlay) : même libellé qu'avec Versus Aucun", () => {
    expect(
      resolveEvolutionScopeSubtitle({
        account: null,
        accountLabel: null,
        envelope: null,
        canUseDailyNavSeries: true,
        navScopeLabel: "Brut",
      })
    ).toBe("Brut — NAV quotidienne");
  });

  it("NAV quotidienne indisponible (dailyNav trop court) : repli \"Actifs bruts\", pipeline history", () => {
    expect(
      resolveEvolutionScopeSubtitle({
        account: null,
        accountLabel: null,
        envelope: null,
        canUseDailyNavSeries: false,
        navScopeLabel: "Net",
      })
    ).toBe("Actifs bruts");
  });

  it("compte sélectionné sans enveloppe : le compte prime sur le périmètre NAV", () => {
    expect(
      resolveEvolutionScopeSubtitle({
        account: "TITRES",
        accountLabel: "Titres",
        envelope: null,
        canUseDailyNavSeries: true,
        navScopeLabel: "Net",
      })
    ).toBe("Compte : Titres");
  });

  it("compte et enveloppe sélectionnés : les deux s'affichent", () => {
    expect(
      resolveEvolutionScopeSubtitle({
        account: "TITRES",
        accountLabel: "Titres",
        envelope: "PEA",
        canUseDailyNavSeries: true,
        navScopeLabel: "Net",
      })
    ).toBe("Compte : Titres · PEA");
  });
});

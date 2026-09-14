/**
 * D25 P2 — un échec réseau n'est pas une absence de donnée.
 *
 * `resolveEvolutionPanelBodyState` est la décision d'affichage extraite du
 * JSX de `PortfolioEvolutionPanel` — testée ici sans rendu, ce dépôt n'ayant
 * pas de harnais DOM. `base()` construit un état neutre (tout à `false`),
 * chaque test ne change que ce qui distingue son scénario.
 */
import { describe, expect, it } from "vitest";
import { resolveEvolutionPanelBodyState } from "@/components/dashboard/portfolio-evolution-panel";

function base() {
  return {
    showIntraday: false,
    showPanelLoading: false,
    mainError: false,
    empty: false,
    wantPocketDailyNav: false,
    pocketError: false,
    pocketEmptyKind: null as "empty" | "too-short" | null,
    noPoints: false,
    envelopeUnknown: false,
    indexUnavailable: false,
    versusNone: true,
    usePocketCurve: false,
    useDailyNavCurve: false,
    chartKindPercent: false,
  };
}

describe("resolveEvolutionPanelBodyState", () => {
  it("l'intraday court-circuite tout le reste", () => {
    expect(
      resolveEvolutionPanelBodyState({
        ...base(),
        showIntraday: true,
        showPanelLoading: true,
        mainError: true,
      })
    ).toBe("intraday");
  });

  it("le chargement passe avant l'échec et avant l'absence", () => {
    expect(
      resolveEvolutionPanelBodyState({
        ...base(),
        showPanelLoading: true,
        mainError: true,
        empty: true,
      })
    ).toBe("loading");
  });

  /*
    Le cœur du correctif : une requête en échec (`mainError`) ne doit jamais
    se lire comme un historique vide, même quand les deux drapeaux se
    trouveraient vrais en même temps (ce qui n'arrive plus depuis que
    `empty` exclut `mainError` côté composant — la priorité ici est la
    garde de rattrapage).
  */
  it("un échec de la requête principale prime sur l'absence de données", () => {
    expect(
      resolveEvolutionPanelBodyState({
        ...base(),
        mainError: true,
        empty: true,
      })
    ).toBe("main-error");
  });

  it("un historique réellement vide, sans erreur, reste \"empty\"", () => {
    expect(resolveEvolutionPanelBodyState({ ...base(), empty: true })).toBe(
      "empty"
    );
  });

  /*
    Symétrique du cas principal, côté poche : une poche dont l'API a rendu
    500 ne doit jamais se lire « pas encore de valorisation ». `pocketError`
    prime sur `pocketEmptyKind`, sur `noPoints`, et sur le rendu d'une courbe
    à zéro point.
  */
  it("un échec de la requête de poche prime sur \"pocket-empty\"", () => {
    expect(
      resolveEvolutionPanelBodyState({
        ...base(),
        wantPocketDailyNav: true,
        pocketError: true,
        pocketEmptyKind: "empty",
        noPoints: true,
      })
    ).toBe("pocket-error");
  });

  it("une poche sans erreur et sans point rend \"pocket-empty\"", () => {
    expect(
      resolveEvolutionPanelBodyState({
        ...base(),
        wantPocketDailyNav: true,
        pocketEmptyKind: "empty",
      })
    ).toBe("pocket-empty");
  });

  it("période trop courte : enveloppe inconnue nommée plutôt que \"élargissez la plage\"", () => {
    expect(
      resolveEvolutionPanelBodyState({
        ...base(),
        noPoints: true,
        envelopeUnknown: true,
      })
    ).toBe("no-points-envelope-unknown");
  });

  it("période trop courte, générique, sans enveloppe en cause", () => {
    expect(resolveEvolutionPanelBodyState({ ...base(), noPoints: true })).toBe(
      "no-points-too-short"
    );
  });

  it("indice indisponible, sans overlay ni série de repli", () => {
    expect(
      resolveEvolutionPanelBodyState({ ...base(), indexUnavailable: true })
    ).toBe("index-unavailable");
  });

  it("poche filtrée, Versus éteint : la courbe de poche", () => {
    expect(
      resolveEvolutionPanelBodyState({
        ...base(),
        wantPocketDailyNav: true,
        versusNone: true,
        usePocketCurve: true,
      })
    ).toBe("pocket-curve");
  });

  it("pas de poche, NAV quotidienne disponible : la courbe daily-nav", () => {
    expect(
      resolveEvolutionPanelBodyState({ ...base(), useDailyNavCurve: true })
    ).toBe("daily-nav-curve");
  });

  it("ni poche ni daily-nav, chartKind valeur : la courbe de valeur", () => {
    expect(resolveEvolutionPanelBodyState(base())).toBe("value-curve");
  });

  it("chartKind percent : la courbe de performance relative", () => {
    expect(
      resolveEvolutionPanelBodyState({ ...base(), chartKindPercent: true })
    ).toBe("percent-curve");
  });
});

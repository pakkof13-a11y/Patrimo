/**
 * D25 P5 — « depuis l'origine » sous un cap de six ans.
 *
 * `evolutionRangePeriodLabel("all")` répond invariablement « depuis
 * l'origine », qui devient faux dès que l'historique réel dépasse le cap de
 * six ans (`MAX_HISTORY_YEARS`) : l'origine réelle n'est plus servie.
 * `kpiPeriodLabelFor` est la décision qui corrige ce seul cas en lisant la
 * borne **servie** — jamais `evolutionRangePeriodLabel` lui-même, qui vit
 * hors du périmètre de ce correctif et sert ailleurs tel quel.
 */
import { describe, expect, it } from "vitest";
import { kpiPeriodLabelFor } from "@/components/dashboard/dashboard-tab";
import { evolutionRangePeriodLabel } from "@/app/lib/ui/evolution-ranges";

describe("kpiPeriodLabelFor", () => {
  it("sur « Tout », lit la borne servie plutôt que d'affirmer l'origine", () => {
    expect(kpiPeriodLabelFor("all", "2020-09-03")).toBe(
      "depuis septembre 2020"
    );
  });

  it("sur « Tout » sans borne servie (chargement ou échec), ne dit rien plutôt que d'annoncer une origine qui n'est pas encore connue", () => {
    expect(kpiPeriodLabelFor("all", undefined)).toBe("");
  });

  /*
    Les sept autres périodes ne dépendent pas de la profondeur d'historique :
    `evolutionRangePeriodLabel` reste la bonne réponse, avec ou sans borne
    servie.
  */
  for (const range of ["7d", "1m", "3m", "6m", "ytd", "1y", "5y"] as const) {
    it(`sur ${range}, reprend evolutionRangePeriodLabel telle quelle`, () => {
      expect(kpiPeriodLabelFor(range, "2020-09-03")).toBe(
        evolutionRangePeriodLabel(range)
      );
      expect(kpiPeriodLabelFor(range, undefined)).toBe(
        evolutionRangePeriodLabel(range)
      );
    });
  }

  /*
    Régression du bug rapporté : sur un historique de douze ans, la tuile
    P&L (« depuis septembre 2020 ») et ses huit voisines ne doivent plus
    jamais diverger — les deux lisent désormais la même décision, sur la
    même borne servie.
  */
  it("ne rend jamais « depuis l'origine » dès que la borne servie est connue", () => {
    const label = kpiPeriodLabelFor("all", "2014-01-15");
    expect(label).not.toBe(evolutionRangePeriodLabel("all"));
    expect(label).toBe("depuis janvier 2014");
  });
});

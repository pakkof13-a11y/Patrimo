import { describe, expect, it } from "vitest";
import {
  firstFamily,
  unresolvedFields,
  type FieldFontRow,
} from "../../tools/input-cascade/harness.mjs";

/**
 * La règle qui empêche le harnais de mesurer une police qu'il n'embarque pas.
 *
 * Sans navigateur, et c'est le point : la garde se vérifie ici, sur des cas
 * qu'on ne peut pas produire dans le dépôt aujourd'hui — un champ monospace en
 * largeur intrinsèque n'existe pas encore. Le jour où il existera, ce sont ces
 * lignes qui auront décidé si le harnais le dit ou le tait.
 *
 * C'est la leçon de D33 : la logique se teste séparée de ce qui la rend lente.
 */

const declared = "IBM Plex Sans";

function champ(over: Partial<FieldFontRow> & { classes: string }): FieldFontRow {
  return { resolved: declared, dependent: false, ...over };
}

describe("unresolvedFields", () => {
  it("laisse passer un champ qui dépend de la police et l'a résolue", () => {
    const rows = [champ({ classes: "input w-auto", dependent: true })];
    expect(unresolvedFields(rows, declared)).toEqual([]);
  });

  /*
    Le cas d'aujourd'hui : les deux champs `font-mono` du dépôt sont en
    `w-full`, à 600 px imposés par leur conteneur. Leur police n'entre dans
    aucune mesure, et le harnais n'a donc aucune raison d'embarquer le Mono.
  */
  it("ne signale pas un champ monospace dont la largeur ne dépend pas de la police", () => {
    const rows = [
      champ({
        classes: "input w-full font-mono text-sm",
        resolved: "IBM Plex Mono absente du harnais",
        dependent: false,
      }),
    ];
    expect(unresolvedFields(rows, declared)).toEqual([]);
  });

  /*
    Le cas de demain, et la raison d'être de cette règle. Que ce champ passe en
    `w-auto` et sa largeur se met à dépendre d'une police absente : sans cette
    garde il hériterait du Sans en silence, et la référence enregistrerait une
    largeur que l'application n'affiche jamais.
  */
  it("signale un champ monospace devenu intrinsèque", () => {
    const rows = [
      champ({
        classes: "input w-auto font-mono text-sm",
        resolved: "IBM Plex Mono absente du harnais",
        dependent: true,
      }),
    ];
    expect(unresolvedFields(rows, declared)).toEqual([
      {
        classes: "input w-auto font-mono text-sm",
        resolved: "IBM Plex Mono absente du harnais",
      },
    ]);
  });

  it("signale aussi un repli générique, pas seulement le monospace", () => {
    // Si la fixture ne chargeait pas, la première famille résolue serait celle
    // du système : le symptôme même que ce chantier corrige.
    const rows = [
      champ({ classes: "input w-auto", resolved: "ui-sans-serif", dependent: true }),
    ];
    expect(unresolvedFields(rows, declared)).toHaveLength(1);
  });

  it("rend la liste complète, pas seulement le premier fautif", () => {
    const rows = [
      champ({ classes: "a", resolved: "X", dependent: true }),
      champ({ classes: "b", dependent: true }),
      champ({ classes: "c", resolved: "Y", dependent: true }),
    ];
    expect(unresolvedFields(rows, declared).map((r) => r.classes)).toEqual(["a", "c"]);
  });
});

describe("firstFamily", () => {
  it("retient la première famille et retire ses guillemets", () => {
    expect(firstFamily('"IBM Plex Sans", ui-sans-serif, system-ui')).toBe("IBM Plex Sans");
    expect(firstFamily("ui-sans-serif, system-ui")).toBe("ui-sans-serif");
    expect(firstFamily("'Segoe UI'")).toBe("Segoe UI");
  });

  it("ne jette pas sur une liste vide", () => {
    expect(firstFamily("")).toBe("");
  });
});

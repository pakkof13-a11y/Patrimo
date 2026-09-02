import { describe, expect, it } from "vitest";
import {
  isEuroFundName,
  normalizeSupportName,
  reconcileSupports,
  type LedgerSupport,
  type TableSupport,
} from "@/app/lib/life-insurance/reconcile";

describe("isEuroFundName", () => {
  it("reconnaît les libellés de fonds euro courants", () => {
    expect(isEuroFundName("Fonds euro Spirica")).toBe(true);
    expect(isEuroFundName("Fonds euro Generali")).toBe(true);
    expect(isEuroFundName("Fonds en euros")).toBe(true);
    expect(isEuroFundName("Sécurité Euro")).toBe(true);
  });

  it("ne prend pas un support actions pour un fonds euro", () => {
    // Piège réel : « Euro Stoxx 50 » est un indice actions. Le confondre avec
    // le fonds euro ferait sauter la migration de la ligne actions et
    // solderait à tort le champ du contrat.
    expect(isEuroFundName("Amundi Euro Stoxx 50")).toBe(false);
    expect(isEuroFundName("UC EuroStoxx")).toBe(false);
    expect(isEuroFundName("UC Amundi MSCI World")).toBe(false);
    expect(isEuroFundName("UC Carmignac Patrimoine")).toBe(false);
    expect(isEuroFundName("ETF World tracker")).toBe(false);
  });
});

describe("normalizeSupportName", () => {
  it("retire le préfixe d'habillage « UC »", () => {
    expect(normalizeSupportName("UC Amundi MSCI World")).toBe(
      normalizeSupportName("Amundi MSCI World")
    );
  });

  it("retire « ETF » comme habillage, pas comme nom", () => {
    expect(normalizeSupportName("ETF World tracker")).toBe("world tracker");
  });

  it("retire les préfixes empilés", () => {
    expect(normalizeSupportName("UC ETF World")).toBe("world");
  });

  it("ignore accents, casse et ponctuation", () => {
    expect(normalizeSupportName("Fonds Euro Sécurité")).toBe(
      normalizeSupportName("fonds  euro   securite")
    );
  });

  it("ne réduit pas un libellé entier à rien quand il n'est qu'un mot d'habillage", () => {
    // « Fonds » seul reste « fonds » : sans garde, la normalisation renverrait
    // une chaîne vide et tous les supports mono-mot se rapprocheraient entre eux.
    expect(normalizeSupportName("Fonds")).toBe("fonds");
    expect(normalizeSupportName("UC")).toBe("uc");
  });

  it("ne rapproche pas deux supports réellement différents", () => {
    expect(normalizeSupportName("UC Amundi MSCI World")).not.toBe(
      normalizeSupportName("UC Carmignac Patrimoine")
    );
  });
});

describe("reconcileSupports", () => {
  const ledger: LedgerSupport[] = [
    { assetId: "a1", name: "Amundi MSCI World", marketValueEur: "87300" },
    { assetId: "a2", name: "Fonds euro Linxea", marketValueEur: "25500" },
    { assetId: "a3", name: "Amundi Euro Stoxx 50", marketValueEur: "5568" },
  ];

  it("détecte le doublon réel de la base de démo", () => {
    // Cas constaté en production : « UC Amundi MSCI World » côté table et
    // « Amundi MSCI World » côté journal désignent la même ligne, comptée deux
    // fois dans le patrimoine net.
    const table: TableSupport[] = [
      { id: "p1", name: "UC Amundi MSCI World", valueEur: "28500" },
      { id: "p2", name: "UC Carmignac Patrimoine", valueEur: "8400" },
    ];

    const { duplicates, tableOnly, ledgerOnly } = reconcileSupports(
      table,
      ledger
    );

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.table.id).toBe("p1");
    expect(duplicates[0]!.ledger.assetId).toBe("a1");
    expect(tableOnly.map((t) => t.id)).toEqual(["p2"]);
    expect(ledgerOnly.map((l) => l.assetId)).toEqual(["a2", "a3"]);
  });

  it("n'apparie un support du journal qu'une seule fois", () => {
    // Deux libellés de table qui se normalisent pareil ne doivent pas
    // « consommer » deux fois la même position : sinon on croirait devoir
    // supprimer deux lignes là où le journal n'en porte qu'une.
    const table: TableSupport[] = [
      { id: "p1", name: "UC Amundi MSCI World", valueEur: "28500" },
      { id: "p2", name: "ETF Amundi MSCI World", valueEur: "1000" },
    ];

    const { duplicates, tableOnly } = reconcileSupports(table, ledger);

    expect(duplicates).toHaveLength(1);
    expect(tableOnly.map((t) => t.id)).toEqual(["p2"]);
  });

  it("classe tout en tableOnly quand le journal est vide", () => {
    const table: TableSupport[] = [
      { id: "p1", name: "Fonds euro Generali", valueEur: "5000" },
    ];
    const { duplicates, tableOnly, ledgerOnly } = reconcileSupports(table, []);
    expect(duplicates).toEqual([]);
    expect(tableOnly).toHaveLength(1);
    expect(ledgerOnly).toEqual([]);
  });

  it("classe tout en ledgerOnly quand la table est vide", () => {
    const { duplicates, tableOnly, ledgerOnly } = reconcileSupports([], ledger);
    expect(duplicates).toEqual([]);
    expect(tableOnly).toEqual([]);
    expect(ledgerOnly).toHaveLength(3);
  });

  it("conserve chaque support dans exactement une catégorie", () => {
    // Invariant : aucune valeur ne doit ni disparaître ni être comptée deux
    // fois par le rapprochement lui-même.
    const table: TableSupport[] = [
      { id: "p1", name: "UC Amundi MSCI World", valueEur: "28500" },
      { id: "p2", name: "UC Carmignac Patrimoine", valueEur: "8400" },
      { id: "p3", name: "Fonds euro Generali", valueEur: "5000" },
    ];
    const r = reconcileSupports(table, ledger);

    expect(r.duplicates.length + r.tableOnly.length).toBe(table.length);
    expect(r.duplicates.length + r.ledgerOnly.length).toBe(ledger.length);
  });

  it("ignore un libellé vide plutôt que de l'apparier au hasard", () => {
    const table: TableSupport[] = [{ id: "p1", name: "   ", valueEur: "100" }];
    const { duplicates, tableOnly } = reconcileSupports(table, ledger);
    expect(duplicates).toEqual([]);
    expect(tableOnly).toHaveLength(1);
  });
});

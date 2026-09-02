import { describe, expect, it } from "vitest";
import { nftExcludePrismaClause } from "@/app/lib/transactions/nft-filter";
import {
  buildTxListWhere,
  parseTxListQuery,
} from "@/app/lib/transactions/list-query";

/**
 * Régression : le journal ne montrait que 10 transactions sur 127.
 *
 * L'exclusion des NFT était écrite `NOT [ … ]` sur des `contains`. En SQL,
 * `NOT (colonne LIKE '…')` vaut `UNKNOWN` quand la colonne est `NULL`, et un
 * `WHERE` ne garde que ce qui est vrai. Résultat : toute transaction sans notes
 * disparaissait, et — via la condition sur `asset.notes`, champ presque
 * toujours vide — **toute transaction portant un actif** aussi. Achats, ventes
 * et dividendes étaient invisibles alors qu'aucun NFT n'existait.
 *
 * Ces tests vérifient la forme de la clause : chaque condition doit offrir une
 * échappatoire pour les valeurs nulles. Le comportement SQL lui-même a été
 * mesuré contre la base (127/127 visibles après correction, les NFT toujours
 * exclus).
 */

type Branch = Record<string, unknown>;

function branchesOf(condition: Branch): Branch[] {
  const or = condition.OR;
  return Array.isArray(or) ? (or as Branch[]) : [];
}

/** true si l'une des branches autorise explicitement une valeur nulle. */
function allowsNull(condition: Branch): boolean {
  return branchesOf(condition).some((b) => {
    for (const value of Object.values(b)) {
      if (value === null) return true;
      // { asset: { is: { champ: null } } }
      if (value && typeof value === "object") {
        const is = (value as Branch).is;
        if (is && typeof is === "object") {
          if (Object.values(is as Branch).some((v) => v === null)) return true;
        }
      }
    }
    return false;
  });
}

describe("clause d'exclusion NFT", () => {
  const clause = nftExcludePrismaClause();

  it("s'exprime en AND de conditions négatives, pas en NOT global", () => {
    // Un NOT d'ensemble ne permet pas à chaque condition de gérer ses nulls.
    expect(Array.isArray(clause.AND)).toBe(true);
    expect(clause.AND.length).toBeGreaterThan(0);
    expect(clause).not.toHaveProperty("NOT");
  });

  it("laisse passer les transactions sans notes", () => {
    for (const condition of clause.AND) {
      expect(allowsNull(condition)).toBe(true);
    }
  });

  it("laisse passer les transactions sans actif", () => {
    // Sinon apports, retraits et frais bancaires disparaîtraient du journal.
    const assetConditions = clause.AND.filter((c) =>
      branchesOf(c).some((b) => "asset" in b)
    );
    expect(assetConditions.length).toBeGreaterThan(0);
    for (const condition of assetConditions) {
      const hasNullAssetBranch = branchesOf(condition).some(
        (b) => b.assetId === null
      );
      expect(hasNullAssetBranch).toBe(true);
    }
  });

  it("ne pose pas de filtre null sur un champ non nullable", () => {
    // `Asset.name` est obligatoire au schéma : Prisma rejette la requête
    // entière si on lui demande `name: null`.
    for (const condition of clause.AND) {
      for (const branch of branchesOf(condition)) {
        const asset = branch.asset as { is?: Branch } | undefined;
        if (asset?.is && "name" in asset.is) {
          expect(asset.is.name).not.toBeNull();
        }
      }
    }
  });

  it("place `mode` au même niveau que `not`", () => {
    // Prisma refuse `not: { contains, mode }` — l'option appartient au filtre
    // de chaîne, pas à son imbrication.
    for (const condition of clause.AND) {
      for (const branch of branchesOf(condition)) {
        const values = [
          ...Object.values(branch),
          ...Object.values((branch.asset as { is?: Branch })?.is ?? {}),
        ];
        for (const v of values) {
          if (!v || typeof v !== "object") continue;
          const not = (v as Branch).not;
          if (not && typeof not === "object") {
            expect(not).not.toHaveProperty("mode");
          }
        }
      }
    }
  });

  it("couvre toujours les signaux NFT attendus", () => {
    const serialized = JSON.stringify(clause).toLowerCase();
    for (const hint of ["nft", "erc-721", "metaplex", "opensea", "collectible"]) {
      expect(serialized).toContain(hint);
    }
  });
});

describe("buildTxListWhere", () => {
  const query = parseTxListQuery(new URLSearchParams(""));

  it("porte l'exclusion NFT en AND, sans NOT résiduel", () => {
    const where = buildTxListWhere("user-1", query) as Record<string, unknown>;
    expect(where.userId).toBe("user-1");
    expect(Array.isArray(where.AND)).toBe(true);
    expect(where).not.toHaveProperty("NOT");
  });

  it("ne filtre par type que si un type est demandé", () => {
    const all = buildTxListWhere("user-1", query) as Record<string, unknown>;
    expect(all.type).toBeUndefined();

    const buys = buildTxListWhere("user-1", {
      ...query,
      typeGroup: "buy",
    }) as Record<string, unknown>;
    expect(buys.type).toBe("ACHAT");
  });

  it("garde l'exclusion NFT même quand le filtre de type est omis", () => {
    // `omitTypeFilter` sert aux compteurs par type : ils doivent compter le
    // même périmètre que la liste, sinon les onglets annoncent des totaux
    // que la liste ne montre pas.
    const counts = buildTxListWhere("user-1", query, {
      omitTypeFilter: true,
    }) as Record<string, unknown>;
    expect(Array.isArray(counts.AND)).toBe(true);
    expect((counts.AND as unknown[]).length).toBeGreaterThan(0);
  });
});

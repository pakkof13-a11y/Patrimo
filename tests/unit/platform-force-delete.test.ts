import { describe, expect, it } from "vitest";

/**
 * Spec cascade force-delete plateforme :
 * les txs liées aux actifs (même si platformId différent) doivent être incluses.
 */
function buildForceDeleteTxWhere(
  userId: string,
  platformId: string,
  assetIds: string[]
) {
  return {
    userId,
    OR: [
      { platformId },
      { toPlatformId: platformId },
      ...(assetIds.length > 0 ? [{ assetId: { in: assetIds } }] : []),
    ],
  };
}

describe("platform force-delete cascade where", () => {
  it("inclut platformId, toPlatformId et assetIds", () => {
    const w = buildForceDeleteTxWhere("u1", "plat-eth", ["asset-a", "asset-b"]);
    expect(w.userId).toBe("u1");
    expect(w.OR).toEqual(
      expect.arrayContaining([
        { platformId: "plat-eth" },
        { toPlatformId: "plat-eth" },
        { assetId: { in: ["asset-a", "asset-b"] } },
      ])
    );
  });

  it("sans actifs : seulement les deux relations plateforme", () => {
    const w = buildForceDeleteTxWhere("u1", "plat-x", []);
    expect(w.OR).toHaveLength(2);
    expect(w.OR).toEqual([
      { platformId: "plat-x" },
      { toPlatformId: "plat-x" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  detectNftDoubleCounting,
  holdingsGoneMissing,
  nftDuplicateIdsToExclude,
  nftEventDedupKey,
  pickBridgeDestination,
  type DedupHolding,
} from "@/app/lib/crypto/nft-dedup";

function holding(overrides: Partial<DedupHolding> & Pick<DedupHolding, "id" | "nftAssetId">): DedupHolding {
  return {
    dataOrigin: "MANUAL",
    status: "HELD",
    linkedHoldingId: null,
    acquisitionDate: null,
    ...overrides,
  };
}

describe("detectNftDoubleCounting — cas 44 (doublon multi-provider)", () => {
  it("ne détecte rien pour des détentions de NFT distincts", () => {
    const conflicts = detectNftDoubleCounting([
      holding({ id: "h1", nftAssetId: "a1" }),
      holding({ id: "h2", nftAssetId: "a2" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("détecte deux détentions actives pour le même NFT, préfère MANUAL à WALLET_SYNC", () => {
    const manual = holding({ id: "h-manual", nftAssetId: "a1", dataOrigin: "MANUAL" });
    const synced = holding({ id: "h-sync", nftAssetId: "a1", dataOrigin: "WALLET_SYNC" });
    const conflicts = detectNftDoubleCounting([synced, manual]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("MULTI_SOURCE_DUPLICATE");
    expect(conflicts[0].keepId).toBe("h-manual");
    expect(conflicts[0].duplicateId).toBe("h-sync");
  });

  it("ignore les détentions inactives (BURNED/TRANSFERRED_OUT/SOLD) — rien à dédupliquer", () => {
    const conflicts = detectNftDoubleCounting([
      holding({ id: "h1", nftAssetId: "a1", status: "SOLD" }),
      holding({ id: "h2", nftAssetId: "a1", status: "BURNED" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("départage par id de façon déterministe à égalité d'origine", () => {
    const a = holding({ id: "hb", nftAssetId: "a1", dataOrigin: "PLATFORM_API" });
    const b = holding({ id: "ha", nftAssetId: "a1", dataOrigin: "PLATFORM_API" });
    const conflicts = detectNftDoubleCounting([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].keepId).toBe("ha");
  });
});

describe("detectNftDoubleCounting — cas 32/33 (bridge/wrap des deux côtés actifs)", () => {
  it("détecte un bridge dont les deux extrémités sont actives, garde la destination", () => {
    const origin = holding({
      id: "origin",
      nftAssetId: "a-origin",
      status: "BRIDGED_OUT",
      linkedHoldingId: "dest",
      acquisitionDate: "2026-01-01",
    });
    const dest = holding({
      id: "dest",
      nftAssetId: "a-dest",
      status: "HELD",
      linkedHoldingId: "origin",
      acquisitionDate: "2026-01-05",
    });
    const conflicts = detectNftDoubleCounting([origin, dest]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("BRIDGE_OR_WRAP_BOTH_SIDES");
    expect(conflicts[0].keepId).toBe("dest");
    expect(conflicts[0].duplicateId).toBe("origin");
  });

  it("ne rapporte la paire bridge qu'une seule fois (pas en double dans les deux sens)", () => {
    const origin = holding({ id: "o", nftAssetId: "a1", linkedHoldingId: "d" });
    const dest = holding({ id: "d", nftAssetId: "a2", linkedHoldingId: "o" });
    const conflicts = detectNftDoubleCounting([origin, dest]);
    expect(conflicts).toHaveLength(1);
  });
});

describe("pickBridgeDestination", () => {
  it("préfère le côté actif quand l'autre est fermé", () => {
    const closed = holding({ id: "closed", nftAssetId: "a1", status: "BRIDGED_OUT" });
    const active = holding({ id: "active", nftAssetId: "a2", status: "HELD" });
    expect(pickBridgeDestination(closed, active).id).toBe("active");
    expect(pickBridgeDestination(active, closed).id).toBe("active");
  });

  it("à statut égal, préfère l'acquisition la plus récente", () => {
    const older = holding({ id: "older", nftAssetId: "a1", acquisitionDate: "2026-01-01" });
    const newer = holding({ id: "newer", nftAssetId: "a2", acquisitionDate: "2026-02-01" });
    expect(pickBridgeDestination(older, newer).id).toBe("newer");
  });

  it("départage par id si tout est égal", () => {
    const a = holding({ id: "b", nftAssetId: "a1" });
    const b = holding({ id: "a", nftAssetId: "a2" });
    expect(pickBridgeDestination(a, b).id).toBe("a");
  });
});

describe("nftDuplicateIdsToExclude", () => {
  it("exclut les duplicateId qui ne sont keepId d'aucun autre conflit", () => {
    const excluded = nftDuplicateIdsToExclude([
      { kind: "MULTI_SOURCE_DUPLICATE", keepId: "keep", duplicateId: "dup", reason: "x" },
    ]);
    expect(excluded.has("dup")).toBe(true);
    expect(excluded.has("keep")).toBe(false);
  });

  it("ne comptabilise pas une entrée qui est à la fois keepId et duplicateId ailleurs comme exclue", () => {
    const excluded = nftDuplicateIdsToExclude([
      { kind: "MULTI_SOURCE_DUPLICATE", keepId: "mid", duplicateId: "leaf", reason: "x" },
      { kind: "BRIDGE_OR_WRAP_BOTH_SIDES", keepId: "root", duplicateId: "mid", reason: "y" },
    ]);
    expect(excluded.has("leaf")).toBe(true);
    expect(excluded.has("mid")).toBe(false);
    expect(excluded.has("root")).toBe(false);
  });
});

describe("holdingsGoneMissing — cas 48 (disparition constatée sur un passage complet)", () => {
  it("signale les détentions précédemment vues qui n'apparaissent plus", () => {
    const missing = holdingsGoneMissing(["a1", "a2", "a3"], new Set(["a1", "a3"]));
    expect(missing).toEqual(["a2"]);
  });

  it("ne signale rien si tout est revu", () => {
    const missing = holdingsGoneMissing(["a1", "a2"], new Set(["a1", "a2"]));
    expect(missing).toEqual([]);
  });

  it("un wallet vide au passage courant signale tout l'historique précédent", () => {
    const missing = holdingsGoneMissing(["a1", "a2"], new Set());
    expect(missing).toEqual(["a1", "a2"]);
  });
});

describe("nftEventDedupKey — rejouabilité d'une resynchronisation (cas 45)", () => {
  it("produit la même clé pour le même NFT/tx/type", () => {
    const k1 = nftEventDedupKey({ nftAssetId: "a1", txHash: "0xABC", eventType: "TRANSFER_IN" });
    const k2 = nftEventDedupKey({ nftAssetId: "a1", txHash: "0xabc", eventType: "TRANSFER_IN" });
    expect(k1).toBe(k2);
  });

  it("distingue deux types d'événements pour le même NFT/tx", () => {
    const k1 = nftEventDedupKey({ nftAssetId: "a1", txHash: "0xabc", eventType: "TRANSFER_IN" });
    const k2 = nftEventDedupKey({ nftAssetId: "a1", txHash: "0xabc", eventType: "SELL" });
    expect(k1).not.toBe(k2);
  });

  it("gère l'absence de txHash sans collisionner avec un événement daté", () => {
    const k1 = nftEventDedupKey({ nftAssetId: "a1", txHash: null, eventType: "MINT" });
    const k2 = nftEventDedupKey({ nftAssetId: "a1", txHash: undefined, eventType: "MINT" });
    expect(k1).toBe(k2);
    expect(k1).toContain("no-tx");
  });
});

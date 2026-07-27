import { describe, expect, it } from "vitest";
import {
  getOpenSeaChain,
  isValidOpenSeaChain,
  listOpenSeaChains,
} from "../app/lib/opensea/chains";

describe("opensea chains", () => {
  it("maps ETHEREUM / BASE presets", () => {
    expect(getOpenSeaChain("ETHEREUM").openseaChain).toBe("ethereum");
    expect(getOpenSeaChain("BASE").openseaChain).toBe("base");
    expect(getOpenSeaChain("SOLANA").openseaChain).toBe("solana");
  });

  it("accepts raw opensea chain ids", () => {
    expect(getOpenSeaChain("arbitrum").openseaChain).toBe("arbitrum");
    expect(isValidOpenSeaChain("polygon")).toBe(true);
  });

  it("defaults unknown to ethereum", () => {
    expect(getOpenSeaChain("UNKNOWN_CHAIN").openseaChain).toBe("ethereum");
  });

  it("lists unique chains", () => {
    const list = listOpenSeaChains();
    const ids = list.map((c) => c.openseaChain);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("ethereum");
  });
});

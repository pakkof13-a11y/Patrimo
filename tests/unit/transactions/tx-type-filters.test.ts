import { describe, expect, it } from "vitest";
import {
  matchesTxTypeFilter,
  TX_TYPE_FILTERS,
} from "@/components/transactions/tx-type-filters";

describe("TX_TYPE_FILTERS — reward / airdrop mutuellement exclusifs", () => {
  it("un AIRDROP ne matche que le filtre airdrop, pas reward", () => {
    expect(matchesTxTypeFilter("AIRDROP", "reward")).toBe(false);
    expect(matchesTxTypeFilter("AIRDROP", "airdrop")).toBe(true);
  });

  it("un REWARD ne matche que le filtre reward", () => {
    expect(matchesTxTypeFilter("REWARD", "reward")).toBe(true);
    expect(matchesTxTypeFilter("REWARD", "airdrop")).toBe(false);
  });

  it("expose un filtre works (Travaux) pour TRAVAUX", () => {
    const works = TX_TYPE_FILTERS.find((f) => f.id === "works");
    expect(works?.types).toEqual(["TRAVAUX"]);
    expect(matchesTxTypeFilter("TRAVAUX", "works")).toBe(true);
  });
});

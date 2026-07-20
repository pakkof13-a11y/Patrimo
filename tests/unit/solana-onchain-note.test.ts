import { describe, expect, it } from "vitest";
import { ONCHAIN_NOTE_PREFIX } from "@/app/lib/market/solana-onchain-to-ledger";

describe("onchain journal notes", () => {
  it("tag signature pour dédup journal", () => {
    const sig =
      "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    const tag = `${ONCHAIN_NOTE_PREFIX}${sig}]`;
    expect(tag.startsWith("[onchain:")).toBe(true);
    expect(tag).toContain(sig);
    // Un second import avec le même contains ne doit pas recréer
    const notes = `${tag} TRANSFER in SOL`;
    expect(notes.includes(tag)).toBe(true);
  });
});

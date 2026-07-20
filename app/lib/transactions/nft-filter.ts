/**
 * Détection NFT — hors vue principale du journal des transactions.
 */

const NFT_HINT =
  /\bnft\b|non[\s-]?fungible|collectible|opensea|blur\.io|magic.?eden|tensor|metaplex|cnft|compressed.?nft|erc[\s-]?721|erc[\s-]?1155|spl[\s-]?nft|token.?metadata|inscription|ordinal/i;

/** Tickers / noms souvent reçus en airdrop (hints de classification). */
export const AIRDROP_TICKER_HINTS = new Set([
  "IQ50",
  "ARB",
  "PSP",
  "OP",
  "ENS",
  "UNI",
  "LOOKS",
  "BLUR",
  "JTO",
  "W",
  "TIA",
  "PYTH",
  "JUP",
  "WEN",
  "BONK",
]);

export function looksLikeNft(input: {
  notes?: string | null;
  assetName?: string | null;
  ticker?: string | null;
  providerSymbol?: string | null;
  assetClass?: string | null;
}): boolean {
  if ((input.assetClass || "").toUpperCase() === "NFT") return true;
  const hay = [
    input.notes,
    input.assetName,
    input.ticker,
    input.providerSymbol,
  ]
    .filter(Boolean)
    .join(" ");
  if (!hay) return false;
  return NFT_HINT.test(hay);
}

/**
 * Prisma `NOT` pour exclure les NFT du journal principal.
 * Heuristique notes / nom / ticker / providerSymbol.
 */
export function nftExcludePrismaClause(): {
  NOT: Array<Record<string, unknown>>;
} {
  const contains = (field: string) => ({
    [field]: { contains: "nft", mode: "insensitive" as const },
  });
  return {
    NOT: [
      { notes: { contains: "nft", mode: "insensitive" } },
      { notes: { contains: "ERC-721", mode: "insensitive" } },
      { notes: { contains: "ERC721", mode: "insensitive" } },
      { notes: { contains: "metaplex", mode: "insensitive" } },
      { asset: { name: { contains: "nft", mode: "insensitive" } } },
      { asset: { notes: { contains: "nft", mode: "insensitive" } } },
      { asset: { providerSymbol: { contains: "nft", mode: "insensitive" } } },
      // collectible / opensea
      { notes: { contains: "opensea", mode: "insensitive" } },
      { notes: { contains: "collectible", mode: "insensitive" } },
      { asset: { name: { contains: "collectible", mode: "insensitive" } } },
    ],
  };
}

/**
 * Si une réception gratuite ressemble à un airdrop (ticker connu ou notes).
 */
export function shouldTagAsAirdrop(input: {
  type?: string | null;
  notes?: string | null;
  ticker?: string | null;
  name?: string | null;
}): boolean {
  const notes = (input.notes || "").toLowerCase();
  if (/air\s*drop|airdrop/.test(notes)) return true;
  const t = (input.ticker || "").trim().toUpperCase();
  if (t && AIRDROP_TICKER_HINTS.has(t)) {
    // Achat cash explicite → pas airdrop
    if ((input.type || "").toUpperCase() === "ACHAT") return false;
    if (/buy|achat|purchase|swap/i.test(notes)) return false;
    return true;
  }
  return false;
}

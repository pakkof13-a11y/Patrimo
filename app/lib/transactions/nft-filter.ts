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

/** Champs texte de la transaction inspectés par l'heuristique NFT. */
type TxTextField = "notes";
/** Champs texte de l'actif lié inspectés par l'heuristique NFT. */
type AssetTextField = "name" | "notes" | "providerSymbol";

/** Motifs cherchés dans les notes de la transaction. */
const TX_NOTE_HINTS = [
  "nft",
  "ERC-721",
  "ERC721",
  "metaplex",
  "opensea",
  "collectible",
] as const;

/**
 * Champs de `Asset` pouvant valoir `NULL` au schéma.
 *
 * `name` est obligatoire : lui appliquer une branche `null` ferait rejeter la
 * requête par Prisma, qui n'accepte pas `null` comme filtre sur un champ non
 * nullable.
 */
const NULLABLE_ASSET_FIELDS = new Set<AssetTextField>([
  "notes",
  "providerSymbol",
]);

/** Motifs cherchés sur l'actif lié, par champ. */
const ASSET_HINTS: ReadonlyArray<[AssetTextField, string]> = [
  ["name", "nft"],
  ["name", "collectible"],
  ["notes", "nft"],
  ["providerSymbol", "nft"],
];

/**
 * « Ce champ de la transaction ne contient pas `needle` », **valeur nulle
 * comprise**.
 *
 * En SQL, `NOT (notes LIKE '%nft%')` vaut `UNKNOWN` quand `notes` est `NULL`,
 * et une clause `WHERE` ne garde que ce qui est vrai : une transaction sans
 * notes disparaissait donc du journal. La branche `null` explicite rétablit la
 * lecture attendue — pas de notes signifie pas de NFT.
 */
function txFieldWithout(
  field: TxTextField,
  needle: string
): Record<string, unknown> {
  return {
    OR: [
      { [field]: null },
      // `mode` est frère de `not` : le filtre imbriqué n'accepte pas l'option.
      { [field]: { mode: "insensitive", not: { contains: needle } } },
    ],
  };
}

/**
 * Même chose sur l'actif lié, avec deux échappatoires supplémentaires : la
 * transaction peut n'avoir aucun actif (apport, retrait, frais bancaires), et
 * l'actif peut avoir le champ vide.
 *
 * Sans elles, un filtre sur `asset.notes` — champ presque toujours vide —
 * écartait **toute transaction portant un actif**, c'est-à-dire tous les
 * achats, ventes et dividendes.
 */
function assetFieldWithout(
  field: AssetTextField,
  needle: string
): Record<string, unknown> {
  // `is:` explicite : sur une relation optionnelle, Prisma n'accepte pas la
  // forme abrégée `asset: { champ: … }`.
  const branches: Array<Record<string, unknown>> = [{ assetId: null }];
  if (NULLABLE_ASSET_FIELDS.has(field)) {
    branches.push({ asset: { is: { [field]: null } } });
  }
  branches.push({
    asset: {
      is: { [field]: { mode: "insensitive", not: { contains: needle } } },
    },
  });
  return { OR: branches };
}

/**
 * Clause Prisma excluant les NFT du journal principal.
 *
 * Rendue sous forme d'un `AND` de conditions déjà négatives, plutôt que d'un
 * `NOT` global : chaque condition peut ainsi gérer ses propres valeurs nulles,
 * ce qu'une négation d'ensemble ne permet pas.
 */
export function nftExcludePrismaClause(): {
  AND: Array<Record<string, unknown>>;
} {
  return {
    AND: [
      ...TX_NOTE_HINTS.map((needle) => txFieldWithout("notes", needle)),
      ...ASSET_HINTS.map(([field, needle]) =>
        assetFieldWithout(field, needle)
      ),
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

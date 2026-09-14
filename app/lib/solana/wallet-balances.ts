/**
 * Snapshot soldes wallet — getBalance + getTokenAccountsByOwner (jsonParsed).
 */

import Decimal from "decimal.js";
import {
  fetchCoingeckoSimplePrices,
  fetchSolanaMintPricesUsd,
} from "@/app/lib/market/providers/coingecko";
import { isSolanaAddress } from "./address";
import { rpcGetBalance, rpcGetTokenAccountsByOwner } from "./rpc-client";
import { resolveSolanaMintMetas, lookupWellKnownMint } from "./token-meta";
import {
  SolanaRpcError,
  type SolanaPortfolioSnapshot,
  type SolanaTokenHolding,
} from "./types";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

type ParsedTokenAmount = {
  uiAmount?: number | null;
  uiAmountString?: string;
  decimals?: number;
  amount?: string;
};

type ParsedTokenAccount = {
  pubkey: { toBase58(): string };
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: ParsedTokenAmount;
        };
      };
    };
  };
};

export async function fetchWalletBalanceSnapshot(
  address: string
): Promise<SolanaPortfolioSnapshot> {
  const addr = address.trim();
  if (!isSolanaAddress(addr)) {
    throw new SolanaRpcError("Adresse Solana invalide (base58)", "INVALID_ADDRESS");
  }

  // Séquentiel : moins de burst 429 sur RPC public
  const lamports = await rpcGetBalance(addr);
  const tokenAccounts = await rpcGetTokenAccountsByOwner(addr);

  /*
    `rpcGetBalance` lève après épuisement des retries : un lamports non
    numérique serait une réponse hors contrat du RPC. Le replier sur `0`
    affichait « ce wallet ne détient pas de SOL » là où la vérité est
    « le solde natif n'a pas pu être lu » — une absence ne se convertit
    pas en zéro.
  */
  if (typeof lamports !== "number" || !Number.isFinite(lamports)) {
    throw new SolanaRpcError(
      "RPC Solana : getBalance n'a pas renvoyé de lamports lisibles — solde natif indisponible (et non nul)",
      "RPC_UNAVAILABLE"
    );
  }
  const solBal = lamports / 1e9;
  const tokensRaw: SolanaTokenHolding[] = [];
  let unresolvedDecimals = 0;

  for (const ta of tokenAccounts as ParsedTokenAccount[]) {
    const info = ta.account?.data?.parsed?.info;
    const mint = info?.mint;
    const taAmt = info?.tokenAmount;
    if (!mint || !taAmt) continue;

    /*
      Les décimales appartiennent au mint : sans elles, un montant est
      illisible et aucune convention ne le rend lisible. Les supposer
      nulles traitait 1 USDC (6 décimales) comme 1 000 000 — un chiffre
      faux, muet, qui part ensuite au patrimoine. Décimales ABSENTES du
      payload = ligne écartée et déclarée (notice + log). Un `0`
      réellement rendu par le RPC reste un `0` : c'est la valeur légitime
      des NFT Metaplex et des spams de même forme, dont la détection plus
      bas dépend.
    */
    const decRaw = taAmt.decimals;
    if (typeof decRaw !== "number" || !Number.isInteger(decRaw) || decRaw < 0) {
      unresolvedDecimals += 1;
      console.warn(
        "[solana-rpc] getTokenAccountsByOwner : décimales absentes du compte token — ligne écartée, aucune quantité supposée",
        {
          mint,
          tokenAccount: safeTokenAccountPubkey(ta),
          rawAmount: taAmt.amount ?? null,
        }
      );
      continue;
    }

    const ui = resolveUiBalance(taAmt, decRaw);
    if (ui == null) continue;
    const n = Number(ui);
    if (!Number.isFinite(n) || n === 0) continue;
    const known = lookupWellKnownMint(mint);
    tokensRaw.push({
      tokenAddress: mint,
      symbol: known?.symbol ?? shortMint(mint),
      name: known?.name ?? mint,
      balance: ui,
      decimals: decRaw,
      priceUsd: null,
      valueUsd: null,
      icon: known?.logoUrl ?? null,
      isNative: false,
    });
  }

  const mintList = tokensRaw
    .map((t) => t.tokenAddress)
    .filter(Boolean) as string[];

  // Métadonnées tickers (Jupiter + well-known) + prix en parallèle
  const [metaByMint, priceRead] = await Promise.all([
    resolveSolanaMintMetas(mintList, { concurrency: 4 }),
    loadPrices(mintList),
  ]);
  const prices = priceRead.map;
  const solPrice = prices.get("native") ?? null;

  const native: SolanaTokenHolding = {
    tokenAddress: null,
    symbol: "SOL",
    name: "Solana",
    balance: String(solBal),
    decimals: 9,
    priceUsd: solPrice,
    valueUsd: solPrice != null ? solBal * solPrice : null,
    icon: null,
    isNative: true,
  };

  const priced = tokensRaw.map((t) => {
    const mint = t.tokenAddress || "";
    const p = prices.get(mint) ?? prices.get(mint.toLowerCase()) ?? null;
    const bal = Number(t.balance);
    const meta =
      metaByMint.get(mint) || metaByMint.get(mint.toLowerCase()) || null;
    return {
      ...t,
      symbol: meta?.symbol ?? t.symbol,
      name: meta?.name ?? t.name,
      icon: meta?.logoUrl ?? t.icon,
      priceUsd: p,
      valueUsd: p != null && Number.isFinite(bal) ? bal * p : null,
    };
  });

  /*
    Un compte token à 1 unité / 0 décimale, sans cotation, est un NFT
    (standard Metaplex : supply 1, decimals 0) ou un spam de même forme —
    pas un actif comptant. Publié ici, il devenait un `Asset` CRYPTO sans
    fiche NFT, jamais coté, donc jamais clôturé : la courbe « Évolution »
    perdait tous ses points dès son entrée (un jour n'entre dans la série
    que si toutes les lignes détenues sont valorisables). Les NFT sont lus
    par le module NFT (`nft-wallet-sync`, Magic Eden) ; le snapshot comptant
    les déclare sans les publier. Un token de cette forme mais coté reste
    comptant : la cotation prime sur la forme.
  */
  const tokens = priced.filter((t) => !isNftShapedHolding(t));
  const nftLikeCount = priced.length - tokens.length;

  tokens.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const parts = [native.valueUsd, ...tokens.map((t) => t.valueUsd)].filter(
    (v): v is number => v != null && Number.isFinite(v)
  );
  const total = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;

  const baseNotice =
    "Source RPC Solana natif (@solana/web3.js). Prix USD via CoinGecko quand disponibles. Pas d’indexeur Solscan.";
  const nftNotice =
    nftLikeCount > 0
      ? ` ${nftLikeCount} compte(s) token à 1 unité sans décimale ni cotation (NFT ou spam) exclu(s) du comptant — lus par la synchronisation NFT.`
      : "";
  const decimalsNotice =
    unresolvedDecimals > 0
      ? ` ${unresolvedDecimals} compte(s) token écarté(s) : décimales absentes du RPC Solana, quantité illisible (indisponible, pas nulle).`
      : "";
  // Prix indisponibles ≠ actifs sans valeur : le total n'est alors qu'une
  // somme partielle, et cela doit se lire à l'écran.
  const priceNotice = priceRead.sourceUnavailable
    ? " Prix CoinGecko indisponibles lors de cette lecture : les valorisations manquantes sont inconnues, pas nulles — le total est partiel."
    : "";

  return {
    address: addr,
    totalValueUsd: total,
    native: solBal > 0 || native.valueUsd != null ? native : native,
    tokens,
    fetchedAt: new Date().toISOString(),
    source: "solana-rpc",
    notice: baseNotice + nftNotice + decimalsNotice + priceNotice,
  };
}

/** Pubkey du compte token pour le log — jamais bloquante. */
function safeTokenAccountPubkey(ta: ParsedTokenAccount): string | null {
  try {
    return ta.pubkey?.toBase58?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Quantité en unité entière d'un compte token.
 *
 * `uiAmountString` / `uiAmount` sont déjà à l'échelle du mint. À défaut, on
 * recompose depuis `amount` (unités de base) et les décimales connues, avec
 * Decimal.js — un supply à 9+ décimales dépasse la précision d'un double.
 * Rien de lisible → `null` : la ligne est écartée, pas mise à zéro.
 */
function resolveUiBalance(
  taAmt: ParsedTokenAmount,
  decimals: number
): string | null {
  const direct =
    taAmt.uiAmountString ??
    (taAmt.uiAmount != null ? String(taAmt.uiAmount) : null);
  if (direct != null && direct !== "" && Number.isFinite(Number(direct))) {
    return direct;
  }
  const raw = taAmt.amount;
  if (raw == null || !/^-?\d+$/.test(String(raw).trim())) return null;
  return new Decimal(String(raw).trim())
    .div(new Decimal(10).pow(decimals))
    .toFixed();
}

/** NFT Metaplex / spam de même forme : 1 unité, 0 décimale, aucune cotation. */
function isNftShapedHolding(t: SolanaTokenHolding): boolean {
  return t.decimals === 0 && Number(t.balance) === 1 && t.priceUsd == null;
}

function shortMint(mint: string): string {
  if (mint.length <= 8) return mint;
  return `${mint.slice(0, 4)}…`;
}

/**
 * Prix USD connus + indication d'indisponibilité du fournisseur.
 *
 * Un prix manquant parce que le token n'est pas coté et un prix manquant
 * parce que CoinGecko n'a pas répondu ne se lisent pas pareil : le second
 * doit se dire, sinon le total passe pour complet.
 */
type PriceRead = { map: Map<string, number>; sourceUnavailable: boolean };

async function loadPrices(mints: string[]): Promise<PriceRead> {
  const map = new Map<string, number>();
  let sourceUnavailable = false;
  try {
    const data = await fetchCoingeckoSimplePrices(
      ["solana", "usd-coin", "tether"],
      ["usd"]
    );
    if (data.solana?.usd != null) map.set("native", data.solana.usd as number);
    if (data["usd-coin"]?.usd != null) {
      map.set(USDC_MINT, data["usd-coin"].usd as number);
    }
    if (data.tether?.usd != null) {
      map.set(USDT_MINT, data.tether.usd as number);
    }
  } catch (e) {
    // Non bloquant pour les quantités (elles sont lues, elles), mais déclaré.
    sourceUnavailable = true;
    console.warn(
      "[coingecko] simple/price indisponible — valorisations Solana inconnues (non nulles)",
      e instanceof Error ? e.message : e
    );
  }

  const need = mints.filter(
    (m) => m !== USDC_MINT && m !== USDT_MINT && !map.has(m)
  );
  if (need.length > 0) {
    try {
      const mintPrices = await fetchSolanaMintPricesUsd(need);
      for (const [k, v] of mintPrices) map.set(k, v);
    } catch (e) {
      sourceUnavailable = true;
      console.warn(
        "[coingecko] prix par mint Solana indisponibles — valorisations inconnues (non nulles)",
        e instanceof Error ? e.message : e
      );
    }
  }
  return { map, sourceUnavailable };
}

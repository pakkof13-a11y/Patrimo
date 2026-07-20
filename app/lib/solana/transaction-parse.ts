/**
 * Parse minimal d’une transaction Solana (getParsedTransaction).
 * N’essaie pas de décoder swaps Jupiter/Raydium de façon sémantique complète.
 */

import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import type { SolanaParsedOnchainTx, SolanaTransferSummary } from "./types";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const STAKE = "Stake11111111111111111111111111111111111111";
const COMPUTE = "ComputeBudget111111111111111111111111111111";

export function parseSolanaTransaction(
  signature: string,
  wallet: string,
  raw: ParsedTransactionWithMeta | null
): SolanaParsedOnchainTx {
  if (!raw) {
    return {
      signature,
      slot: null,
      blockTime: null,
      status: "unknown",
      feeSol: null,
      feeLamports: null,
      programIds: [],
      primaryProgramId: null,
      transfers: [],
      functionalType: "UNKNOWN",
      err: "transaction_not_found",
    };
  }

  const err = raw.meta?.err
    ? typeof raw.meta.err === "string"
      ? raw.meta.err
      : JSON.stringify(raw.meta.err)
    : null;
  const status = err ? "failed" : "success";
  const feeLamports = raw.meta?.fee ?? null;
  const feeSol =
    feeLamports != null ? String(feeLamports / 1e9) : null;

  const programIds = collectProgramIds(raw);
  const primaryProgramId =
    programIds.find(
      (p) => p !== SYSTEM && p !== COMPUTE && p !== TOKEN && p !== TOKEN_2022
    ) ||
    programIds[0] ||
    null;

  const transfers = [
    ...extractSolTransfers(raw, wallet),
    ...extractSplTransfers(raw, wallet),
  ];

  let functionalType: SolanaParsedOnchainTx["functionalType"] = "UNKNOWN";
  if (status === "failed") functionalType = "FAILED";
  else if (programIds.includes(STAKE)) functionalType = "STAKE_LIKE";
  else if (transfers.length >= 2 && hasBothDirections(transfers)) {
    functionalType = "SWAP_LIKE";
  } else if (transfers.length > 0) functionalType = "TRANSFER";

  return {
    signature,
    slot: raw.slot ?? null,
    blockTime: raw.blockTime ? new Date(raw.blockTime * 1000) : null,
    status,
    feeSol,
    feeLamports,
    programIds,
    primaryProgramId,
    transfers,
    functionalType,
    err,
  };
}

function collectProgramIds(raw: ParsedTransactionWithMeta): string[] {
  const ids = new Set<string>();
  const msg = raw.transaction.message;
  // web3.js parsed message
  const keys =
    "accountKeys" in msg
      ? (msg as { accountKeys: Array<string | { pubkey: { toBase58(): string } | string }> })
          .accountKeys
      : [];
  for (const k of keys) {
    if (typeof k === "string") ids.add(k);
    else if (k && typeof k === "object") {
      const pk = (k as { pubkey?: { toBase58?: () => string } | string }).pubkey;
      if (typeof pk === "string") ids.add(pk);
      else if (pk && typeof pk.toBase58 === "function") ids.add(pk.toBase58());
    }
  }
  const instructions = (msg as { instructions?: Array<{ programId?: unknown }> })
    .instructions;
  if (Array.isArray(instructions)) {
    for (const ix of instructions) {
      const pid = ix.programId;
      if (typeof pid === "string") ids.add(pid);
      else if (pid && typeof (pid as { toBase58?: () => string }).toBase58 === "function") {
        ids.add((pid as { toBase58: () => string }).toBase58());
      }
    }
  }
  return [...ids];
}

function extractSolTransfers(
  raw: ParsedTransactionWithMeta,
  wallet: string
): SolanaTransferSummary[] {
  const out: SolanaTransferSummary[] = [];
  const pre = raw.meta?.preBalances || [];
  const post = raw.meta?.postBalances || [];
  const keys = getAccountKeyStrings(raw);
  const wi = keys.indexOf(wallet);
  if (wi < 0 || pre[wi] == null || post[wi] == null) return out;
  const delta = (post[wi] - pre[wi]) / 1e9;
  // fee already deducted from fee payer; still report net SOL change
  if (Math.abs(delta) < 1e-12) return out;
  out.push({
    kind: "SOL",
    direction: delta > 0 ? "in" : "out",
    amount: String(Math.abs(delta)),
    decimals: 9,
    from: delta < 0 ? wallet : null,
    to: delta > 0 ? wallet : null,
  });
  return out;
}

function extractSplTransfers(
  raw: ParsedTransactionWithMeta,
  wallet: string
): SolanaTransferSummary[] {
  const out: SolanaTransferSummary[] = [];
  const pre = raw.meta?.preTokenBalances || [];
  const post = raw.meta?.postTokenBalances || [];
  // index by accountIndex+mint
  type Key = string;
  const map = new Map<Key, { mint: string; owner?: string; pre: number; post: number; dec: number }>();

  for (const b of pre) {
    const owner = b.owner || "";
    const mint = b.mint;
    const k = `${b.accountIndex}:${mint}`;
    const ui = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
    map.set(k, {
      mint,
      owner,
      pre: Number.isFinite(ui) ? ui : 0,
      post: 0,
      dec: b.uiTokenAmount?.decimals ?? 0,
    });
  }
  for (const b of post) {
    const mint = b.mint;
    const k = `${b.accountIndex}:${mint}`;
    const ui = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
    const cur = map.get(k) || {
      mint,
      owner: b.owner || "",
      pre: 0,
      post: 0,
      dec: b.uiTokenAmount?.decimals ?? 0,
    };
    cur.post = Number.isFinite(ui) ? ui : 0;
    cur.owner = b.owner || cur.owner;
    cur.dec = b.uiTokenAmount?.decimals ?? cur.dec;
    map.set(k, cur);
  }

  for (const v of map.values()) {
    if (v.owner !== wallet) continue;
    const delta = v.post - v.pre;
    if (Math.abs(delta) < 1e-12) continue;
    out.push({
      kind: "SPL",
      direction: delta > 0 ? "in" : "out",
      mint: v.mint,
      amount: String(Math.abs(delta)),
      decimals: v.dec,
      from: delta < 0 ? wallet : null,
      to: delta > 0 ? wallet : null,
    });
  }
  return out;
}

function getAccountKeyStrings(raw: ParsedTransactionWithMeta): string[] {
  const msg = raw.transaction.message as {
    accountKeys?: Array<
      string | { pubkey: string | { toBase58(): string }; signer?: boolean }
    >;
  };
  const keys = msg.accountKeys || [];
  return keys.map((k) => {
    if (typeof k === "string") return k;
    const pk = k.pubkey;
    if (typeof pk === "string") return pk;
    if (pk && typeof pk.toBase58 === "function") return pk.toBase58();
    return "";
  });
}

function hasBothDirections(t: SolanaTransferSummary[]): boolean {
  const hasIn = t.some((x) => x.direction === "in");
  const hasOut = t.some((x) => x.direction === "out");
  return hasIn && hasOut;
}

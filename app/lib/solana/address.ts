/** Base58 Solana (hors 0x EVM) — longueur typique 32–44. */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(raw: string | null | undefined): boolean {
  const a = (raw || "").trim();
  if (!a || a.startsWith("0x") || a.startsWith("0X")) return false;
  return SOLANA_ADDRESS_RE.test(a);
}

export function shortSolanaAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

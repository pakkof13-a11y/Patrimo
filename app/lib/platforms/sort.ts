/** Tri configurable de l'onglet Mes plateformes — fonction pure. */

export type PlatformSortMode = "value" | "name" | "activity" | "positions" | "type";

export type SortablePlatform = {
  name: string;
  type: string;
  positionCount?: number;
  lastTransactionAt?: string | null;
  totalValueBase?: string;
  totalValueEur?: string;
  cashBase?: string;
  cashEur?: string;
};

/** Même repli que resolvePlatformValue() côté composant (dupliqué ici pour rester pur/testable). */
function resolveValue(p: SortablePlatform): number {
  const raw = p.totalValueBase || p.totalValueEur || p.cashBase || p.cashEur || "0";
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function byName(a: SortablePlatform, b: SortablePlatform): number {
  return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
}

export function parsePlatformSortMode(
  value: string | null | undefined
): PlatformSortMode {
  return value === "name" ||
    value === "activity" ||
    value === "positions" ||
    value === "type"
    ? value
    : "value";
}

/** Comparateur pour Array.sort — copiez le tableau avant de trier (non muté ici). */
export function comparePlatforms(
  a: SortablePlatform,
  b: SortablePlatform,
  mode: PlatformSortMode
): number {
  switch (mode) {
    case "name":
      return byName(a, b);
    case "activity": {
      const ta = a.lastTransactionAt ? new Date(a.lastTransactionAt).getTime() : -Infinity;
      const tb = b.lastTransactionAt ? new Date(b.lastTransactionAt).getTime() : -Infinity;
      if (tb !== ta) return tb - ta;
      return byName(a, b);
    }
    case "positions": {
      const pa = a.positionCount ?? 0;
      const pb = b.positionCount ?? 0;
      if (pb !== pa) return pb - pa;
      return byName(a, b);
    }
    case "type": {
      const t = a.type.localeCompare(b.type, "fr", { sensitivity: "base" });
      if (t !== 0) return t;
      return byName(a, b);
    }
    case "value":
    default: {
      const va = resolveValue(b);
      const vb = resolveValue(a);
      if (va !== vb) return va - vb;
      return byName(a, b);
    }
  }
}

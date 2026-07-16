/**
 * Aggregate alternative-asset valuations for net-worth and dashboards.
 * Extensible: each sleeve can later plug automated pricing sources.
 *
 * Defensive: if Prisma client is stale (model undefined) or a table is missing,
 * we return zeros instead of crashing GET /api/holdings.
 */

import { prisma } from "@/app/lib/prisma";
import { d, zero } from "@/app/lib/money/decimal";
import { convertToEurSync, getEurRates } from "@/app/lib/market/fx";
import type { AlternativesPortfolioSlice } from "./types";

function sumFieldEur(
  rows: Array<{ currency: string; value: string }>,
  rates: Record<string, number>
) {
  let total = zero();
  for (const r of rows) {
    total = total.plus(d(convertToEurSync(r.value, r.currency || "EUR", rates)));
  }
  return total;
}

type Delegate = {
  findMany: (args: unknown) => Promise<
    Array<{
      currentValue?: { toString(): string };
      currentNav?: { toString(): string };
      capitalInvested?: { toString(): string };
      estimatedValue?: { toString(): string };
      currency?: string;
      status?: string;
    }>
  >;
};

function getDelegate(name: string): Delegate | null {
  const client = prisma as unknown as Record<string, Delegate | undefined>;
  const del = client[name];
  if (!del || typeof del.findMany !== "function") {
    console.warn(
      `[alternatives] Prisma model "${name}" unavailable — run: npx prisma generate (stop next dev first)`
    );
    return null;
  }
  return del;
}

async function safeFindMany(
  modelName: string,
  args: unknown
): Promise<
  Array<{
    currentValue?: { toString(): string };
    currentNav?: { toString(): string };
    capitalInvested?: { toString(): string };
    estimatedValue?: { toString(): string };
    currency?: string;
    status?: string;
  }>
> {
  const del = getDelegate(modelName);
  if (!del) return [];
  try {
    return await del.findMany(args);
  } catch (e) {
    console.error(`[alternatives] ${modelName}.findMany failed:`, e);
    return [];
  }
}

const EMPTY: AlternativesPortfolioSlice = {
  metalsEur: 0,
  privateEquityEur: 0,
  crowdlendingEur: 0,
  tangiblesEur: 0,
  totalEur: 0,
  slices: [],
};

/**
 * Total market value (EUR) of all alternative sleeves for a user.
 */
export async function getAlternativesPortfolioSlice(
  userId: string,
  rates?: Record<string, number>
): Promise<AlternativesPortfolioSlice> {
  try {
    const fx = rates ?? (await getEurRates());

    const [metals, pe, cl, tangibles] = await Promise.all([
      safeFindMany("preciousMetalPosition", {
        where: { userId },
        select: { currentValue: true, currency: true },
      }),
      safeFindMany("privateEquityPosition", {
        where: { userId },
        select: { currentNav: true, currency: true },
      }),
      safeFindMany("crowdlendingPosition", {
        where: { userId },
        select: { capitalInvested: true, currency: true, status: true },
      }),
      safeFindMany("tangibleAsset", {
        where: { userId },
        select: { estimatedValue: true, currency: true },
      }),
    ]);

    const metalsEur = sumFieldEur(
      metals.map((m) => ({
        value: m.currentValue?.toString() ?? "0",
        currency: m.currency || "EUR",
      })),
      fx
    );
    const privateEquityEur = sumFieldEur(
      pe.map((p) => ({
        value: p.currentNav?.toString() ?? "0",
        currency: p.currency || "EUR",
      })),
      fx
    );
    const clActive = cl.filter((c) => c.status === "ACTIVE" || c.status === "LATE");
    const crowdlendingEur = sumFieldEur(
      clActive.map((c) => ({
        value: c.capitalInvested?.toString() ?? "0",
        currency: c.currency || "EUR",
      })),
      fx
    );
    const tangiblesEur = sumFieldEur(
      tangibles.map((t) => ({
        value: t.estimatedValue?.toString() ?? "0",
        currency: t.currency || "EUR",
      })),
      fx
    );

    const m = metalsEur.toNumber();
    const p = privateEquityEur.toNumber();
    const c = crowdlendingEur.toNumber();
    const t = tangiblesEur.toNumber();
    const totalEur = m + p + c + t;

    return {
      metalsEur: m,
      privateEquityEur: p,
      crowdlendingEur: c,
      tangiblesEur: t,
      totalEur,
      slices: [
        { id: "metals", name: "Métaux précieux", value: Math.round(m * 100) / 100 },
        {
          id: "private-equity",
          name: "Private Equity",
          value: Math.round(p * 100) / 100,
        },
        {
          id: "crowdlending",
          name: "Crowdlending",
          value: Math.round(c * 100) / 100,
        },
        {
          id: "tangibles",
          name: "Actifs tangibles",
          value: Math.round(t * 100) / 100,
        },
      ].filter((s) => s.value > 0),
    };
  } catch (e) {
    console.error("[alternatives] getAlternativesPortfolioSlice failed:", e);
    return EMPTY;
  }
}

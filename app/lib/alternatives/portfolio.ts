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
import {
  buildAlternativesShortAlerts,
  type AlternativesDashboardPayload,
  type AlternativesPortfolioSlice,
} from "./types";
import { listPreciousMetals } from "./precious-metals";
import { listPrivateEquity } from "./private-equity";
import { listCrowdlending } from "./crowdlending";
import { listTangibles } from "./tangibles";
import { buildConsolidatedInvestments } from "./consolidated";

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

function getDelegate(name: string): Delegate {
  const client = prisma as unknown as Record<string, Delegate | undefined>;
  const del = client[name];
  if (!del || typeof del.findMany !== "function") {
    /*
      Modèle absent du client généré. Cela n'arrive qu'en développement, quand
      le client n'a pas été régénéré après une migration.

      Rendre un tableau vide faisait passer « je ne peux pas lire cette poche »
      pour « cette poche est vide » : la valeur disparaissait du patrimoine
      sans que rien ne le dise. On échoue franchement, message d'aide compris.
    */
    throw new Error(
      `[alternatives] modèle Prisma « ${name} » indisponible — lancez : npx prisma generate (arrêtez next dev d'abord)`
    );
  }
  return del;
}

async function findRows(
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
  // L'erreur remonte : une poche illisible n'est pas une poche vide.
  return getDelegate(modelName).findMany(args);
}

/**
 * Total market value (EUR) of all alternative sleeves for a user.
 */
export async function getAlternativesPortfolioSlice(
  userId: string,
  rates?: Record<string, number>
): Promise<AlternativesPortfolioSlice> {
  const fx = rates ?? (await getEurRates());

  const [metals, pe, cl, tangibles] = await Promise.all([
    findRows("preciousMetalPosition", {
      where: { userId },
      select: { currentValue: true, currency: true },
    }),
    findRows("privateEquityPosition", {
      where: { userId },
      select: { currentNav: true, currency: true },
    }),
    findRows("crowdlendingPosition", {
      where: { userId },
      select: { capitalInvested: true, currency: true, status: true },
    }),
    findRows("tangibleAsset", {
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
}

/**
 * Bundle dashboard : une seule réponse HTTP avec agrégat EUR + summaries par poche.
 * Évite le fan-out client (5 requêtes) au mount de l’onglet Alternatifs.
 */
export async function getAlternativesDashboardBundle(
  userId: string
): Promise<AlternativesDashboardPayload> {
  const [metals, pe, cl, tangibles, summary] = await Promise.all([
    listPreciousMetals(userId),
    listPrivateEquity(userId),
    listCrowdlending(userId),
    listTangibles(userId),
    getAlternativesPortfolioSlice(userId),
  ]);

  return {
    summary,
    metals: metals.summary,
    privateEquity: pe.summary,
    crowdlending: cl.summary,
    tangibles: tangibles.summary,
    shortAlerts: buildAlternativesShortAlerts(cl.summary, pe.summary),
    /*
      Les quatre listes étaient déjà chargées pour en tirer les summaries, puis
      jetées. Les consolider ici ne coûte aucune requête de plus et donne à la
      vue d'ensemble sa liste unique sans quatre appels réseau supplémentaires.
    */
    investments: buildConsolidatedInvestments({
      metals: metals.lines,
      privateEquity: pe.lines,
      crowdlending: cl.lines,
      tangibles: tangibles.lines,
    }),
  };
}

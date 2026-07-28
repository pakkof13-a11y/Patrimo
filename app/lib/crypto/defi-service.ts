/**
 * Assemblage des positions DeFi — seule couche de ce module qui touche Prisma.
 *
 * La valeur de chaque position vient de `getHoldings()`, c'est-à-dire du
 * journal, jamais d'un champ recopié. `DefiPositionDetail` n'apporte que le
 * contexte : protocole, nature, rendement, santé du prêt.
 */

import { d } from "@/app/lib/money/decimal";
import { prisma } from "@/app/lib/prisma";
import { getAssetValues } from "@/app/lib/portfolio/asset-values";
import {
  resolveCoingeckoId,
  fetchCoingeckoSimplePrices,
} from "@/app/lib/market/providers/coingecko";
import {
  computeImpermanentLoss,
  type ImpermanentLossLeg,
} from "./impermanent-loss";
import {
  computeLockSummary,
  type VestingTranche,
} from "./vesting";
import {
  groupByProtocol,
  groupByStrategy,
  groupByType,
  summarizeDefi,
  toPositionView,
  type DefiPositionInput,
  type StrategyGroup,
} from "./defi";

export type DefiBundle = {
  positions: ReturnType<typeof toPositionView>[];
  byProtocol: ReturnType<typeof groupByProtocol>;
  byType: ReturnType<typeof groupByType>;
  /**
   * `groupByStrategy` ignore le nom (fonction pure, pas d'accès Prisma) :
   * on l'attache ici, seule couche qui a chargé les `DefiStrategy`.
   */
  byStrategy: Array<StrategyGroup & { name: string }>;
  summary: ReturnType<typeof summarizeDefi>;
  /**
   * IL par position LP, tenue à part de `positions` : c'est une métrique
   * indicative (cf. `impermanent-loss.ts`), pas une valorisation — la
   * mélanger aux champs financiers de `DefiPositionView` laisserait croire
   * qu'elle est de même nature que `valueEur`.
   */
  impermanentLoss: Map<
    string,
    { pctOfHodl: string; amountEur: string; legsPriced: number; legsTotal: number }
  >;
  /**
   * Détail par jeton des rewards d'une position, premier reward inclus —
   * `DefiPositionInput.rewardsValueEur` n'en porte que le total, cette carte
   * est la seule à connaître la répartition par token (affichage détaillé).
   */
  rewardLegs: Map<
    string,
    Array<{ symbol: string; amount: string; valueEur: string; source: string | null }>
  >;
  /**
   * Présent uniquement pour les positions portant `unlockAt`, `cliffAt` ou
   * `vestingSchedule` — l'immense majorité des positions n'a aucune
   * contrainte de déblocage, les en absenter évite un flot d'entrées `null`.
   */
  lockStatus: Map<
    string,
    {
      isLocked: boolean;
      vestedPct: string | null;
      nextUnlockAt: string | null;
      totalAmount: string | null;
      vestedAmount: string | null;
    }
  >;
};

type StoredLpLeg = {
  symbol?: unknown;
  amount?: unknown;
  entryPriceEur?: unknown;
  allocationPct?: unknown;
};

type StoredRewardLeg = {
  symbol?: unknown;
  amount?: unknown;
  valueEur?: unknown;
  source?: unknown;
};

function parsePairedLegs(json: unknown): StoredLpLeg[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (l): l is StoredLpLeg => typeof l === "object" && l !== null
  );
}

type StoredVestingTranche = {
  cliffAt?: unknown;
  endAt?: unknown;
  amount?: unknown;
};

function parseVestingSchedule(json: unknown): VestingTranche[] {
  if (!Array.isArray(json)) return [];
  const out: VestingTranche[] = [];
  for (const raw of json) {
    if (typeof raw !== "object" || raw === null) continue;
    const t = raw as StoredVestingTranche;
    if (!t.endAt || t.amount == null) continue;
    out.push({
      cliffAt: typeof t.cliffAt === "string" ? t.cliffAt : null,
      endAt: String(t.endAt),
      amount: String(t.amount),
    });
  }
  return out;
}

function parseExtraRewardLegs(json: unknown): StoredRewardLeg[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (l): l is StoredRewardLeg => typeof l === "object" && l !== null
  );
}

/**
 * Charge les positions DeFi de l'utilisateur, valorisées par le journal.
 *
 * Une position dont l'actif n'a plus de quantité est écartée : elle a été
 * fermée, et l'afficher à 0 € encombrerait la vue. Ses écritures restent au
 * journal, où elles ont leur place.
 */
export async function getDefiBundle(userId: string): Promise<DefiBundle> {
  const details = await prisma.defiPositionDetail.findMany({
    where: { asset: { is: { userId } } },
    include: {
      asset: { select: { id: true, name: true, ticker: true } },
    },
  });

  if (details.length === 0) {
    const empty: DefiPositionInput[] = [];
    return {
      positions: [],
      byProtocol: groupByProtocol(empty),
      byType: groupByType(empty),
      byStrategy: [],
      summary: summarizeDefi(empty),
      impermanentLoss: new Map(),
      rewardLegs: new Map(),
      lockStatus: new Map(),
    };
  }

  // Valeurs **par actif**, et non via `getHoldings()` : celui-ci fusionne les
  // lignes crypto de même ticker, si bien qu'un ETH staké et un ETH en
  // portefeuille n'y forment qu'une ligne. Y lire la valeur d'une position
  // DeFi lui ferait absorber le solde comptant — un double comptage.
  const values = await getAssetValues(
    userId,
    details.map((r) => r.assetId)
  );

  const inputs: DefiPositionInput[] = [];
  const rewardLegs: DefiBundle["rewardLegs"] = new Map();
  const lockStatus: DefiBundle["lockStatus"] = new Map();
  for (const row of details) {
    const value = values.get(row.assetId);
    // Pas de position au journal = position fermée.
    if (!value) continue;
    const valueEur = value.marketValueEur;
    if (valueEur.abs().lt("0.01")) continue;

    // Total des rewards toutes tokens confondus : `rewardsValueEur` du
    // `DefiPositionInput` reste un seul chiffre (c'est ce que `summarizeDefi`
    // sait additionner) — la répartition par jeton vit à part, dans
    // `rewardLegs`, pour l'affichage détaillé.
    const primaryReward = row.rewardsValueEur ? d(row.rewardsValueEur.toString()) : null;
    const extraLegsParsed = parseExtraRewardLegs(row.extraRewardLegs);
    let totalRewards = primaryReward ?? d(0);
    const legsForPosition: Array<{
      symbol: string;
      amount: string;
      valueEur: string;
      source: string | null;
    }> = [];
    if (row.rewardsSymbol) {
      legsForPosition.push({
        symbol: row.rewardsSymbol,
        amount: row.rewardsAmount ? row.rewardsAmount.toString() : "0",
        valueEur: (primaryReward ?? d(0)).toFixed(2),
        source: null,
      });
    }
    for (const leg of extraLegsParsed) {
      const legValue = leg.valueEur != null ? d(String(leg.valueEur)) : d(0);
      totalRewards = totalRewards.plus(legValue);
      legsForPosition.push({
        symbol: String(leg.symbol ?? ""),
        amount: leg.amount != null ? String(leg.amount) : "0",
        valueEur: legValue.toFixed(2),
        source: leg.source != null ? String(leg.source) : null,
      });
    }
    if (legsForPosition.length > 0) rewardLegs.set(row.id, legsForPosition);

    if (row.unlockAt || row.cliffAt || row.vestingSchedule) {
      const lock = computeLockSummary({
        unlockAt: row.unlockAt,
        cliffAt: row.cliffAt,
        vestingSchedule: parseVestingSchedule(row.vestingSchedule),
      });
      lockStatus.set(row.id, {
        isLocked: lock.isLocked,
        vestedPct: lock.vestedPct?.toFixed(2) ?? null,
        nextUnlockAt: lock.nextUnlockAt?.toISOString() ?? null,
        totalAmount: lock.totalAmount?.toFixed(8) ?? null,
        vestedAmount: lock.vestedAmount?.toFixed(8) ?? null,
      });
    }

    inputs.push({
      id: row.id,
      protocol: row.protocol,
      chain: row.chain,
      positionType: row.positionType,
      assetSymbol: row.asset.ticker || row.asset.name,
      // La valeur d'un emprunt est portée en positif : c'est
      // `isDebtPosition()` qui lui donne son signe, à un seul endroit.
      valueEur: valueEur.abs(),
      rewardsValueEur: totalRewards.gt(0) ? totalRewards : null,
      apyPct: row.apyPct ? d(row.apyPct.toString()) : null,
      healthFactor: row.healthFactor ? Number(row.healthFactor) : null,
      ltvPct: row.ltvPct ? Number(row.ltvPct) : null,
      strategyId: row.strategyId,
    });
  }

  const impermanentLoss = await computeLpImpermanentLoss(details, values);

  const strategyIds = [...new Set(inputs.map((p) => p.strategyId).filter((id): id is string => !!id))];
  const strategyNames = strategyIds.length
    ? await prisma.defiStrategy.findMany({
        where: { id: { in: strategyIds }, userId },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(strategyNames.map((s) => [s.id, s.name]));

  return {
    positions: inputs.map(toPositionView),
    byProtocol: groupByProtocol(inputs),
    byType: groupByType(inputs),
    byStrategy: groupByStrategy(inputs).map((g) => ({
      ...g,
      name: nameById.get(g.strategyId) ?? g.strategyId,
    })),
    summary: summarizeDefi(inputs),
    impermanentLoss,
    rewardLegs,
    lockStatus,
  };
}

/**
 * IL de chaque position LP.
 *
 * Le premier jeton est valorisé par le journal (entrée = coût moyen, actuel =
 * prix courant de l'Asset) — jamais recopié. Les jetons suivants n'ont pas
 * d'Asset propre (ce n'est pas une position ouverte séparément) : leur prix
 * d'entrée vient de la saisie, leur prix courant est résolu via CoinGecko,
 * en un seul appel batché pour toute la liste — le budget d'appels du
 * fournisseur est déjà partagé ailleurs dans l'app, pas la peine de le
 * refaire ici par position.
 */
async function computeLpImpermanentLoss(
  details: Awaited<ReturnType<typeof prisma.defiPositionDetail.findMany>>,
  values: Awaited<ReturnType<typeof getAssetValues>>
): Promise<DefiBundle["impermanentLoss"]> {
  const out: DefiBundle["impermanentLoss"] = new Map();
  const lpRows = details.filter(
    (r) => r.positionType === "LP" && r.pairedSymbol && values.get(r.assetId)
  );
  if (lpRows.length === 0) return out;

  // Un seul batch CoinGecko pour toutes les jambes non-primaires de toutes
  // les positions LP de l'utilisateur.
  const idsBySymbol = new Map<string, string>();
  for (const row of lpRows) {
    const symbols = [row.pairedSymbol!, ...parsePairedLegs(row.pairedLegs).map((l) => String(l.symbol ?? ""))];
    for (const sym of symbols) {
      const s = sym.trim().toUpperCase();
      if (!s || idsBySymbol.has(s)) continue;
      const cgId = resolveCoingeckoId(s);
      if (cgId) idsBySymbol.set(s, cgId);
    }
  }

  let cgPrices: Record<string, Record<string, number | undefined>> = {};
  if (idsBySymbol.size > 0) {
    try {
      cgPrices = await fetchCoingeckoSimplePrices([...idsBySymbol.values()], ["eur"]);
    } catch (e) {
      // Prix indisponibles → IL non calculable pour les jambes concernées,
      // pas une erreur qui doit faire échouer tout l'onglet DeFi.
      console.error("[defi-service] CoinGecko simple/price", e);
    }
  }
  const priceForSymbol = (sym: string): number | null => {
    const cgId = idsBySymbol.get(sym.trim().toUpperCase());
    if (!cgId) return null;
    const p = cgPrices[cgId]?.eur;
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  };

  for (const row of lpRows) {
    const primary = values.get(row.assetId)!;
    const primaryEntry =
      primary.quantity.gt(0) ? primary.costBasisEur.div(primary.quantity) : null;
    if (!primaryEntry || primaryEntry.lte(0)) continue;

    // `depositedEur` de chaque jambe = quantité × prix d'entrée : c'est la
    // base en euros que `computeImpermanentLoss` convertit en montant
    // absolu. Pour la première jambe elle est déjà calculée par le journal
    // (`costBasisEur`) ; les suivantes n'ont pas d'Asset, donc pas de
    // costBasis — recalculée ici à partir de la saisie.
    const legs: ImpermanentLossLeg[] = [
      {
        symbol: "primary",
        entryPriceEur: primaryEntry,
        currentPriceEur: primary.priceEur,
        weightPct: row.token1AllocationPct ? d(row.token1AllocationPct.toString()) : null,
      },
    ];
    let depositedEur = primary.costBasisEur;
    let legsPriced = primary.priceEur.gt(0) ? 1 : 0;
    const legsTotal = { count: 1 };

    const addLeg = (
      symbol: string,
      amountRaw: unknown,
      entryPriceRaw: unknown,
      weightRaw: unknown
    ) => {
      const sym = symbol.trim();
      const amount = amountRaw != null ? d(String(amountRaw)) : d(0);
      const entryPriceEur = entryPriceRaw != null ? d(String(entryPriceRaw)) : d(0);
      if (!sym || amount.lte(0) || entryPriceEur.lte(0)) return;
      legsTotal.count += 1;
      depositedEur = depositedEur.plus(amount.times(entryPriceEur));
      const current = priceForSymbol(sym);
      if (current != null) legsPriced += 1;
      legs.push({
        symbol: sym,
        entryPriceEur,
        currentPriceEur: current != null ? d(current) : d(0),
        weightPct: weightRaw != null ? d(String(weightRaw)) : null,
      });
    };

    if (row.pairedSymbol) {
      addLeg(
        row.pairedSymbol,
        row.pairedAmount?.toString(),
        row.pairedEntryPriceEur?.toString(),
        row.pairedAllocationPct?.toString()
      );
    }
    for (const extra of parsePairedLegs(row.pairedLegs)) {
      addLeg(
        String(extra.symbol ?? ""),
        extra.amount,
        extra.entryPriceEur,
        extra.allocationPct
      );
    }

    // Une jambe au prix courant indisponible fausserait l'IL (elle serait
    // vue comme ayant perdu 100 % de sa valeur) : ne pas calculer plutôt que
    // d'afficher un chiffre qui ment.
    if (legs.length < 2 || legsPriced < legsTotal.count) continue;

    const il = computeImpermanentLoss(legs, depositedEur);
    if (!il) continue;

    out.set(row.id, {
      pctOfHodl: il.pctOfHodl.times(100).toFixed(2),
      amountEur: il.amountEur.toFixed(2),
      legsPriced,
      legsTotal: legsTotal.count,
    });
  }

  return out;
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { d, type Decimal } from "@/app/lib/money/decimal";
import { convertToEurSync, getEurRates } from "@/app/lib/market/fx";
import { listTradingAccounts } from "@/app/lib/trading/account-service";
import { computeTradingAnalytics } from "@/app/lib/trading/analytics";
import { toFuturesView, type FuturesDirection } from "@/app/lib/crypto/futures";
import {
  compareTradingTax,
  computeTradingYear,
  totalCarryForward,
  type CarriedLoss,
} from "@/app/lib/trading/tax";

/**
 * Convertit un montant de la devise de cotation vers l'euro (FIN-02).
 *
 * `toFuturesView` rend ses montants dans la devise de cotation de
 * l'instrument (`USDT` sur un perpétuel BTC/USDT) — jamais convertis. Les
 * sommer tels quels sous une étiquette « Eur » (`computeTradingOverview`)
 * mélangerait des devises différentes derrière un total qui prétend n'en
 * être qu'une. `null` si le montant est déjà inconnu (TRA-03) ou si la
 * devise de cotation n'a pas de taux (USDT, USDC) — jamais une parité
 * inventée ni un zéro qui ferait disparaître la position des sommes.
 */
function toEur(
  amount: Decimal | null,
  quoteCurrency: string,
  rates: Record<string, number>
): Decimal | null {
  if (amount == null) return null;
  try {
    return d(convertToEurSync(amount, quoteCurrency || "EUR", rates));
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Accumulateur d'un exercice — gains, pertes et frais déductibles. */
function emptyBucket() {
  return { gains: d(0), losses: d(0), fees: d(0) };
}

/**
 * GET /api/trading
 *
 * Comptes, analytique du journal et situation fiscale de l'année.
 *
 * `?year=` cible un exercice, `?tmi=` fournit la tranche marginale pour la
 * comparaison PFU / barème — absente, la comparaison n'est pas calculée plutôt
 * que devinée.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const tmiRaw = url.searchParams.get("tmi");
  const tmi = tmiRaw != null && tmiRaw !== "" ? Number(tmiRaw) : null;

  try {
    const [accounts, positions, rates] = await Promise.all([
      listTradingAccounts(userId),
      prisma.tradingPosition.findMany({
        where: { userId },
        orderBy: [{ closedAt: "desc" }, { openedAt: "desc" }],
      }),
      getEurRates(),
    ]);

    // Le journal ne retient que les positions closes : une position ouverte
    // n'a pas de résultat, seulement un latent qui peut encore s'inverser.
    const closed = positions.filter((p) => !p.isOpen);
    const analytics = computeTradingAnalytics(
      closed.map((p) => ({
        realizedPnlEur: d(p.realizedPnl?.toString() ?? "0"),
        openedAt: p.openedAt,
        closedAt: p.closedAt,
      }))
    );

    // Résultat par exercice, frais de financement et commissions déduits —
    // ils diminuent bien le résultat imposable.
    type YearBucket = ReturnType<typeof emptyBucket>;
    const byYear = new Map<number, YearBucket>();

    for (const p of closed) {
      const closedYear = p.closedAt?.getFullYear();
      if (closedYear == null) continue;
      const pnl = d(p.realizedPnl?.toString() ?? "0");
      const bucket = byYear.get(closedYear) ?? emptyBucket();
      if (pnl.gt(0)) bucket.gains = bucket.gains.plus(pnl);
      else if (pnl.lt(0)) bucket.losses = bucket.losses.plus(pnl.abs());
      bucket.fees = bucket.fees
        .plus(d(p.fundingPaid?.toString() ?? "0"))
        .plus(d(p.commissionPaid?.toString() ?? "0"));
      byYear.set(closedYear, bucket);
    }

    // Les exercices sont rejoués dans l'ordre chronologique : le stock de
    // moins-values reportables d'une année dépend de tout ce qui précède.
    // Sans cet enchaînement, une année perdante serait simplement oubliée.
    let stock: CarriedLoss[] = [];
    let fiscalYear = computeTradingYear(
      { year, grossGainsEur: d(0), grossLossesEur: d(0), feesEur: d(0) },
      []
    );
    for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
      if (y > year) break;
      const b = byYear.get(y)!;
      const res = computeTradingYear(
        { year: y, grossGainsEur: b.gains, grossLossesEur: b.losses, feesEur: b.fees },
        stock
      );
      stock = res.carryForward;
      if (y === year) fiscalYear = res;
    }

    const current = byYear.get(year) ?? emptyBucket();
    const { gains, losses, fees } = current;

    const comparison = compareTradingTax(fiscalYear.taxableEur, tmi);

    return NextResponse.json(
      {
        accounts: accounts.map((a) => ({
          ...a,
          openDate: a.openDate?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        positions: positions.map((p) => {
          /*
            Les valeurs dérivées viennent du moteur `crypto/futures.ts`, pas
            d'un second calcul côté client : notionnel, marge et prix de
            liquidation estimé y sont déjà définis, et deux implémentations
            finiraient par diverger sur le signe d'un short.
          */
          const view = toFuturesView({
            id: p.id,
            exchange: p.exchange,
            pair: p.pair,
            direction: p.direction as FuturesDirection,
            leverage: d(p.leverage.toString()),
            sizeContracts: d(p.sizeContracts.toString()),
            entryPrice: d(p.entryPrice.toString()),
            markPrice: p.markPrice ? d(p.markPrice.toString()) : null,
            marginUsed: p.marginUsed ? d(p.marginUsed.toString()) : null,
            fundingPaid: p.fundingPaid ? d(p.fundingPaid.toString()) : null,
            commissionPaid: p.commissionPaid
              ? d(p.commissionPaid.toString())
              : null,
            marginType: p.marginType,
            /*
              Aucune source n'alimente `contractValue` (pas de colonne en base
              — TRA-03 reste en attente d'une migration) : toujours UNKNOWN
              pour un contrat COIN-M.
            */
            contractValue: null,
          });
          return {
          id: p.id,
          tradingAccountId: p.tradingAccountId,
          underlyingType: p.underlyingType,
          exchange: p.exchange,
          instrument: p.pair,
          contractType: p.contractType,
          direction: p.direction,
          leverage: p.leverage.toString(),
          sizeContracts: p.sizeContracts.toString(),
          entryPrice: p.entryPrice.toString(),
          markPrice: p.markPrice?.toString() ?? null,
          markPriceUpdatedAt: p.markPriceUpdatedAt?.toISOString() ?? null,
          stopLoss: p.stopLoss?.toString() ?? null,
          takeProfit: p.takeProfit?.toString() ?? null,
          expiryDate: p.expiryDate?.toISOString() ?? null,
          tickValue: p.tickValue?.toString() ?? null,
          fundingPaid: p.fundingPaid?.toString() ?? null,
          commissionPaid: p.commissionPaid?.toString() ?? null,
          unrealizedPnl: p.unrealizedPnl?.toString() ?? null,
          realizedPnl: p.realizedPnl?.toString() ?? null,
          isOpen: p.isOpen,
          openedAt: p.openedAt?.toISOString() ?? null,
          closedAt: p.closedAt?.toISOString() ?? null,

          // Champs déjà stockés, jusqu'ici absents de la réponse.
          marginType: p.marginType,
          baseCurrency: p.baseCurrency,
          quoteCurrency: p.quoteCurrency,
          subAccountLabel: p.subAccountLabel,
          exchangeTradeId: p.exchangeTradeId,
          notes: p.notes,
          /** Prix de liquidation renvoyé par l'exchange, s'il en a fourni un. */
          liquidationPriceReported: p.liquidationPrice?.toString() ?? null,

          derived: {
            notionalEur:
              toEur(view.notionalUsd, p.quoteCurrency, rates)?.toFixed(2) ?? null,
            marginUsedEur:
              toEur(view.marginUsed, p.quoteCurrency, rates)?.toFixed(2) ?? null,
            /** Estimation Aurea — barème de maintenance approché, pas contractuel. */
            liquidationPriceEstimated:
              view.liquidationPrice?.toFixed(8) ?? null,
            distanceToLiquidationPct: view.distanceToLiquidationPct,
            unrealizedPnlEur:
              toEur(view.unrealizedPnlEur, p.quoteCurrency, rates)?.toFixed(2) ??
              null,
            signedNotionalEur:
              toEur(view.signedNotional, p.quoteCurrency, rates)?.toFixed(2) ??
              null,
            liquidationAlert: view.liquidationAlert,
            fundingAlert: view.fundingAlert,
          },
          };
        }),
        analytics: {
          tradeCount: analytics.tradeCount,
          winCount: analytics.winCount,
          lossCount: analytics.lossCount,
          breakEvenCount: analytics.breakEvenCount,
          winRatePct: analytics.winRatePct?.toFixed(1) ?? null,
          grossProfitEur: analytics.grossProfitEur.toFixed(2),
          grossLossEur: analytics.grossLossEur.toFixed(2),
          netPnlEur: analytics.netPnlEur.toFixed(2),
          averageWinEur: analytics.averageWinEur?.toFixed(2) ?? null,
          averageLossEur: analytics.averageLossEur?.toFixed(2) ?? null,
          riskRewardRatio: analytics.riskRewardRatio?.toFixed(2) ?? null,
          profitFactor: analytics.profitFactor?.toFixed(2) ?? null,
          maxDrawdownEur: analytics.maxDrawdownEur.toFixed(2),
          bestTradeEur: analytics.bestTradeEur?.toFixed(2) ?? null,
          worstTradeEur: analytics.worstTradeEur?.toFixed(2) ?? null,
          averageHoldingDays:
            analytics.averageHoldingDays != null
              ? Number(analytics.averageHoldingDays.toFixed(1))
              : null,
        },
        fiscal: {
          year,
          grossGainsEur: gains.toFixed(2),
          grossLossesEur: losses.toFixed(2),
          feesEur: fees.toFixed(2),
          netBeforeCarryEur: fiscalYear.netBeforeCarryEur.toFixed(2),
          carryUsedEur: fiscalYear.carryUsedEur.toFixed(2),
          taxableEur: fiscalYear.taxableEur.toFixed(2),
          newLossEur: fiscalYear.newLossEur.toFixed(2),
          expiredEur: fiscalYear.expiredEur.toFixed(2),
          carryForwardEur: totalCarryForward(fiscalYear.carryForward).toFixed(2),
          carryForward: fiscalYear.carryForward.map((c) => ({
            year: c.year,
            remainingEur: c.remainingEur.toFixed(2),
          })),
          pfu: {
            incomeTaxEur: comparison.pfu.incomeTaxEur.toFixed(2),
            socialChargesEur: comparison.pfu.socialChargesEur.toFixed(2),
            totalEur: comparison.pfu.totalEur.toFixed(2),
            effectiveRatePct: comparison.pfu.effectiveRatePct.toFixed(2),
          },
          // Absent tant que la tranche marginale n'est pas fournie : l'app ne
          // connaît pas les revenus du foyer, un taux inventé produirait un
          // arbitrage trompeur.
          bareme: comparison.bareme
            ? {
                marginalRatePct: comparison.bareme.marginalRatePct.toFixed(1),
                incomeTaxEur: comparison.bareme.incomeTaxEur.toFixed(2),
                socialChargesEur: comparison.bareme.socialChargesEur.toFixed(2),
                totalEur: comparison.bareme.totalEur.toFixed(2),
                effectiveRatePct: comparison.bareme.effectiveRatePct.toFixed(2),
              }
            : null,
          cheaper: comparison.cheaper,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[trading GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement du trading") },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { listAccounts } from "@/app/lib/securities/account-service";
import { getSecuritiesFiscalBundle } from "@/app/lib/securities/fiscal-service";
import {
  listSecuritiesPositions,
  summarizePositions,
} from "@/app/lib/securities/positions-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/securities
 *
 * Comptes titres, situation fiscale et lignes détenues. Rien n'est stocké en
 * agrégat : la valeur vient du journal, les totaux ne peuvent donc pas diverger
 * de l'onglet Positions.
 *
 * Les Decimal sont rendus en chaînes — précision préservée jusqu'au navigateur.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const [accounts, fiscal, positions] = await Promise.all([
      listAccounts(userId),
      getSecuritiesFiscalBundle(userId),
      listSecuritiesPositions(userId),
    ]);

    const fiscalById = new Map(fiscal.map((f) => [f.accountId, f]));

    return NextResponse.json(
      {
        accounts: accounts.map((a) => {
          const f = fiscalById.get(a.id);
          const held = positions.filter((p) => p.securitiesAccountId === a.id);
          const totals = summarizePositions(held);

          return {
            id: a.id,
            envelopeType: a.envelopeType,
            envelopeLabel: a.envelopeLabel,
            platformId: a.platformId,
            platformName: a.platformName,
            platformLogoUrl: a.platformLogoUrl,
            openDate: a.openDate.toISOString(),
            iban: a.iban,
            notes: a.notes,
            positionCount: totals.positionCount,

            marketValueEur: totals.marketValueEur.toFixed(2),
            costBasisEur: totals.costBasisEur.toFixed(2),
            unrealizedPnlEur: totals.unrealizedPnlEur.toFixed(2),
            unrealizedPnlPct: totals.unrealizedPnlPct?.toFixed(2) ?? null,

            cashEur: f?.cashEur.toFixed(2) ?? "0.00",
            // Faux quand la poche de l'enveloppe n'a pas pu être imputée à ce
            // compte : l'UI doit le dire plutôt que d'afficher 0 € comme un fait.
            cashAttributed: f?.cashAttributed ?? false,
            liquidationValueEur: f?.liquidationValueEur.toFixed(2) ?? "0.00",

            contributionsEur: f?.contributionsEur.toFixed(2) ?? "0.00",
            withdrawalsEur: f?.withdrawalsEur.toFixed(2) ?? "0.00",
            gainEur: f?.gainEur.toFixed(2) ?? "0.00",

            // Absents sur un compte-titres : ni règle des 5 ans, ni plafond.
            maturity: f?.maturity
              ? {
                  maturityDate: f.maturity.maturityDate.toISOString(),
                  isMatured: f.maturity.isMatured,
                  ageYears: f.maturity.ageYears,
                  daysToMaturity: f.maturity.daysToMaturity,
                }
              : null,
            room: f?.room
              ? {
                  ownCapEur: f.room.ownCapEur.toFixed(2),
                  contributionsEur: f.room.contributionsEur.toFixed(2),
                  combinedContributionsEur:
                    f.room.combinedContributionsEur.toFixed(2),
                  remainingEur: f.room.remainingEur.toFixed(2),
                  overCapEur: f.room.overCapEur.toFixed(2),
                  usedPct: f.room.usedPct.toFixed(2),
                  isOverCap: f.room.isOverCap,
                  bindingCap: f.room.bindingCap,
                }
              : null,
            taxStatusLabel: f?.taxStatusLabel ?? null,
          };
        }),

        positions: positions.map((p) => ({
          assetId: p.assetId,
          securitiesAccountId: p.securitiesAccountId,
          accountType: p.accountType,
          name: p.name,
          ticker: p.ticker,
          isin: p.isin,
          category: p.category,
          currency: p.currency,
          logoUrl: p.logoUrl,
          platformName: p.platformName,
          quantity: p.quantity.toString(),
          costBasisEur: p.costBasisEur.toFixed(2),
          unitCostBasisEur: p.unitCostBasisEur?.toFixed(6) ?? null,
          priceEur: p.priceEur.toFixed(6),
          marketValueEur: p.marketValueEur.toFixed(2),
          unrealizedPnlEur: p.unrealizedPnlEur.toFixed(2),
          unrealizedPnlPct: p.unrealizedPnlPct?.toFixed(2) ?? null,
        })),

        summary: (() => {
          const totals = summarizePositions(positions);
          return {
            marketValueEur: totals.marketValueEur.toFixed(2),
            costBasisEur: totals.costBasisEur.toFixed(2),
            unrealizedPnlEur: totals.unrealizedPnlEur.toFixed(2),
            unrealizedPnlPct: totals.unrealizedPnlPct?.toFixed(2) ?? null,
            positionCount: totals.positionCount,
            accountCount: accounts.length,
          };
        })(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[securities GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des comptes titres") },
      { status: 500 }
    );
  }
}

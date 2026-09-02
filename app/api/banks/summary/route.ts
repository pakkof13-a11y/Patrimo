import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { listBankAccounts, listSavingsAccounts } from "@/app/lib/cash/pockets";
import { listTermDeposits } from "@/app/lib/cash/term-deposits-list";
import { summarizeCash } from "@/app/lib/cash/summary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/banks/summary
 *
 * KPI de tête de l'onglet Banques. Recalculé à chaque appel depuis les
 * mêmes listes que les sections Comptes courants / Livrets / CAT — jamais
 * un total stocké à part, qui pourrait diverger de ce que l'utilisateur voit
 * juste en dessous.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  const base = new URL(req.url).searchParams.get("base") || "EUR";

  const [checking, savings, termDeposits] = await Promise.all([
    listBankAccounts(userId, base),
    listSavingsAccounts(userId, base),
    listTermDeposits(userId, base),
  ]);

  const summary = summarizeCash(checking, savings, termDeposits);

  return NextResponse.json(
    {
      checkingTotalBase: summary.checkingTotalBase.toFixed(2),
      savingsTotalBase: summary.savingsTotalBase.toFixed(2),
      termDepositTotalBase: summary.termDepositTotalBase.toFixed(2),
      weightedApyPct: summary.weightedApyPct?.toFixed(3) ?? null,
      projectedAnnualInterestBase: summary.projectedAnnualInterestBase.toFixed(2),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

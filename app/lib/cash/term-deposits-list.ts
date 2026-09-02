/**
 * Liste des dépôts à terme (CAT), convertis en devise de base.
 *
 * Sur le modèle de `listBankAccounts` / `listSavingsAccounts` (pockets.ts) :
 * mêmes conventions de conversion, même forme de retour (id, principal natif
 * + base, statut d'échéance calculé côté serveur pour ne pas dupliquer la
 * logique de date côté client).
 */

import { prisma } from "../prisma";
import { convertFromEurSync, convertToEurSync, getEurRates } from "../market/fx";
import { maturityStatus, daysUntilMaturity } from "./term-deposit-service";

export async function listTermDeposits(userId: string, base = "EUR") {
  const rates = await getEurRates();
  const rows = await prisma.termDeposit.findMany({
    where: { userId },
    orderBy: { maturityDate: "asc" },
  });
  const now = new Date();
  return rows.map((t) => {
    const principal = t.principal.toString();
    return {
      id: t.id,
      bankName: t.bankName,
      principal,
      principalBase: convertFromEurSync(
        convertToEurSync(principal, t.currency, rates),
        base,
        rates
      ),
      ratePercent: t.ratePercent.toString(),
      currency: t.currency,
      openedAt: t.openedAt.toISOString(),
      maturityDate: t.maturityDate.toISOString(),
      earlyWithdrawalPenaltyPct: t.earlyWithdrawalPenaltyPct?.toString() ?? null,
      isPro: t.isPro,
      ownershipPct: t.ownershipPct?.toString() ?? null,
      notes: t.notes,
      status: maturityStatus(t.maturityDate, now),
      daysUntilMaturity: daysUntilMaturity(t.maturityDate, now),
    };
  });
}

/**
 * Traduction d'une ligne `Transaction` Prisma vers le type du journal.
 *
 * Extrait de `service.ts` pour que le moteur de valorisation historique puisse
 * la réutiliser sans créer de cycle d'import : le service consomme le moteur,
 * le moteur ne doit donc rien importer du service.
 */

import { d } from "../money/decimal";
import type { LedgerTx, TxType } from "../accounting/types";

export function mapDbTx(row: {
  id: string;
  type: string;
  platformId: string;
  toPlatformId: string | null;
  assetId: string | null;
  quantity: { toString(): string } | null;
  unitPrice: { toString(): string } | null;
  fees: { toString(): string };
  currency: string;
  fxRateToEur: { toString(): string };
  grossAmountEur: { toString(): string };
  /*
    Retenue à la source — facultatifs, parce que tous les appelants ne les
    sélectionnent pas et qu'ils ne concernent que les revenus.

    Ils étaient absents de cette signature : `LedgerTx` les déclare, la branche
    revenus du rejeu les lit pour créditer `gross − retenue − frais`, et le
    mapper ne les recopiait pas. Le rejeu voyait donc toujours zéro et créditait
    le brut — 52,78 € de trop sur le compte de démonstration, à la fois dans
    l'indicateur « Réalisé + revenus » et dans le solde de la plateforme.
  */
  withholdingTaxEur?: { toString(): string } | null;
  withholdingTaxRate?: { toString(): string } | null;
  occurredAt: Date;
}): LedgerTx {
  const qty = row.quantity ? d(row.quantity.toString()) : null;
  const unit = row.unitPrice ? d(row.unitPrice.toString()) : null;
  const fees = d(row.fees.toString());
  const fx = d(row.fxRateToEur.toString());
  const grossEur = d(row.grossAmountEur.toString());
  // For cash ops without qty/price, recover original amount from EUR / fx
  const cashAmountOriginal =
    qty && unit
      ? qty.times(unit)
      : [
            "APPORT",
            "RETRAIT",
            "FRAIS",
            "DIVIDENDE",
            "COUPON",
            "LOYER",
            "INTERET",
            "TRANSFERT_CASH",
            // Travaux capitalisés : le montant porte la dépense immobilisée et
            // n'est déductible d'aucune quantité × prix. L'omettre ici ferait
            // rejouer un montant nul, et le ledger rejetterait la transaction.
            "TRAVAUX",
          ].includes(row.type)
        ? fx.isZero()
          ? grossEur
          : grossEur.div(fx)
        : null;

  return {
    id: row.id,
    type: row.type as TxType,
    platformId: row.platformId,
    toPlatformId: row.toPlatformId,
    assetId: row.assetId,
    quantity: qty,
    unitPrice: unit,
    fees,
    currency: row.currency,
    fxRateToEur: fx,
    cashAmountOriginal,
    grossOriginal: qty && unit ? qty.times(unit) : null,
    withholdingTaxEur: row.withholdingTaxEur
      ? d(row.withholdingTaxEur.toString())
      : null,
    withholdingTaxRate: row.withholdingTaxRate
      ? d(row.withholdingTaxRate.toString())
      : null,
    occurredAt: row.occurredAt,
  };
}

/**
 * Types d'evenements d'une dette.
 *
 * Extraits de `./service` pour que `./payment-baseline` puisse les nommer sans
 * refermer un cycle d'import : le service consomme la borne de paiement, la
 * borne ne doit donc rien importer du service. `./service` les reexporte — les
 * appelants historiques ne changent pas.
 */
export const LIABILITY_EVENT_TYPES = {
  MONTHLY_DEBIT: "MONTHLY_DEBIT",
  EARLY_REPAYMENT_PARTIAL: "EARLY_REPAYMENT_PARTIAL",
  EARLY_REPAYMENT_TOTAL: "EARLY_REPAYMENT_TOTAL",
  PAYMENT_CHANGE: "PAYMENT_CHANGE",
  RATE_CHANGE: "RATE_CHANGE",
} as const;

export type LiabilityEventType =
  (typeof LIABILITY_EVENT_TYPES)[keyof typeof LIABILITY_EVENT_TYPES];

export type NotificationType = "TP_HIT" | "SL_HIT";

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** ISO timestamp */
  timestamp: string;
  isRead: boolean;
  /** Optional deep-link metadata */
  assetName?: string;
  unitPrice?: string;
  quantity?: string;
};

export type TriggerFillEvent = {
  name: string;
  fills: Array<{
    kind: string;
    quantity: string;
    unitPrice: string;
  }>;
  error?: string;
};

export function notificationFromTriggerFill(
  assetName: string,
  fill: { kind: string; quantity: string; unitPrice: string }
): AppNotification | null {
  const kind = (fill.kind || "").toUpperCase();
  const isSl = kind === "SL";
  const isTp = kind.startsWith("TP");
  if (!isSl && !isTp) return null;

  const type: NotificationType = isSl ? "SL_HIT" : "TP_HIT";
  const price = Number(fill.unitPrice);
  const qty = Number(fill.quantity);
  const priceLabel = Number.isFinite(price)
    ? price.toLocaleString("fr-FR", { maximumFractionDigits: 6 })
    : fill.unitPrice;
  const qtyLabel = Number.isFinite(qty)
    ? qty.toLocaleString("fr-FR", { maximumFractionDigits: 6 })
    : fill.quantity;

  if (isSl) {
    return {
      id: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      title: "Alerte de protection",
      message: `[SL] Vente de protection de ${assetName} à ${priceLabel} € (qté ${qtyLabel}).`,
      timestamp: new Date().toISOString(),
      isRead: false,
      assetName,
      unitPrice: fill.unitPrice,
      quantity: fill.quantity,
    };
  }

  const tpLabel = kind.length > 2 ? kind : "TP";
  return {
    id: `tp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    title: "Objectif atteint",
    message: `[${tpLabel}] Vente automatique de ${assetName} à ${priceLabel} € (qté ${qtyLabel}).`,
    timestamp: new Date().toISOString(),
    isRead: false,
    assetName,
    unitPrice: fill.unitPrice,
    quantity: fill.quantity,
  };
}

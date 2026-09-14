import { describe, it, expect } from "vitest";
import { amountOrUnknown } from "@/components/trading/position-list";
import { buildPositionView } from "@/app/lib/trading/positions-view";
import { formatCurrency } from "@/app/lib/utils";
import type { TradingPositionRow } from "@/components/trading/types";

/**
 * Un notionnel non calculable faisait tomber toute l'application.
 *
 * La table des positions affichait `formatCurrency(String(v.notionalEur))`.
 * Sur une position ouverte dont le notionnel est inconnu — TRA-03 : couple de
 * devises sans taux, contrat COIN-M sans valeur de contrat — `String(null)`
 * rend la chaîne « null ». Cette chaîne n'est une absence pour personne :
 * `d()` ne neutralise que `null`, `undefined` et `""`, donc « null » filait
 * jusqu'à `new Decimal("null")`, qui lève `[DecimalError] Invalid argument:
 * null`. L'exception remontait le rendu de la table jusqu'à l'ErrorBoundary
 * global, qui remplaçait l'écran entier par son message d'erreur : plus de
 * navigation, plus d'onglets, plus rien.
 *
 * L'inconnue doit rester une inconnue à l'écran — jamais 0, jamais une
 * exception.
 */

function row(over: Partial<TradingPositionRow> = {}): TradingPositionRow {
  return {
    id: "p-unknown",
    tradingAccountId: null,
    underlyingType: "CRYPTO",
    exchange: "BINANCE",
    instrument: "ZZTEST",
    contractType: "PERPETUAL",
    direction: "LONG",
    leverage: "2",
    sizeContracts: "1",
    entryPrice: "100",
    markPrice: "100",
    markPriceUpdatedAt: null,
    expiryDate: null,
    fundingPaid: null,
    commissionPaid: null,
    unrealizedPnl: null,
    realizedPnl: null,
    isOpen: true,
    openedAt: "2026-09-13T22:15:45.387Z",
    closedAt: null,
    stopLoss: null,
    takeProfit: null,
    tickValue: null,
    marginType: "USDT_M",
    baseCurrency: "ZZT",
    quoteCurrency: "USDT",
    subAccountLabel: null,
    exchangeTradeId: null,
    notes: null,
    liquidationPriceReported: null,
    derived: {
      notionalEur: null,
      marginUsedEur: null,
      liquidationPriceEstimated: "50.50000000",
      distanceToLiquidationPct: 49.5,
      unrealizedPnlEur: null,
      signedNotionalEur: null,
      liquidationAlert: false,
      fundingAlert: false,
    },
    ...over,
  };
}

describe("montant non calculable dans la table des positions", () => {
  it("le piège : la chaîne « null » n'est pas une absence pour Decimal", () => {
    expect(() => formatCurrency(String(null), "EUR")).toThrow(
      /Invalid argument: null/
    );
  });

  it("un montant inconnu s'affiche comme inconnu, sans lever", () => {
    expect(amountOrUnknown(null, "EUR")).toBe("—");
    expect(() => amountOrUnknown(null, "EUR")).not.toThrow();
  });

  it("un montant inconnu ne se replie jamais sur zéro", () => {
    expect(amountOrUnknown(null, "EUR")).not.toBe(
      formatCurrency("0", "EUR")
    );
  });

  it("un montant connu reste formaté à l'identique", () => {
    expect(amountOrUnknown(1234.5, "EUR")).toBe(formatCurrency("1234.5", "EUR"));
    expect(amountOrUnknown(0, "EUR")).toBe(formatCurrency("0", "EUR"));
  });

  it("une position ouverte sans notionnel calculable se rend sans exception", () => {
    const v = buildPositionView(row(), new Date("2026-09-13T23:00:00.000Z"));
    expect(v.notionalEur).toBeNull();
    expect(v.marginEur).toBeNull();
    expect(() => amountOrUnknown(v.notionalEur, "EUR")).not.toThrow();
    expect(() => amountOrUnknown(v.marginEur, "EUR")).not.toThrow();
  });
});

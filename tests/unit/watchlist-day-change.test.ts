import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { closeWithinStaleDays, MAX_STALE_DAYS } from "@/app/lib/portfolio/class-history";

/**
 * P1.4 — colonne « Var. » de la watchlist.
 *
 * Logique pure, miroir du bloc `getHoldings` (service.ts) : la variation de
 * séance compare le cours actuel à la clôture d'hier (`AssetDailyClose` sur
 * `parisYesterdayKey`), jamais au coût de revient. Confondre les deux
 * affichait le P&L latent depuis l'achat (`unrealizedPnlPct`) sous
 * l'étiquette « Var. », ce qui donnait +211 % à la fois pour BTC et NVDA —
 * deux actifs sans rapport, simplement parce que les deux positions avaient
 * à peu près triplé depuis leur premier achat.
 *
 * Valeurs reprises telles que lues en base (audit P1.4, 2026-09-15) :
 * - BTC  : qty totale 1.695352, coût total 35 788.85 €, cours 65 804 €
 *          → unrealizedPnlPct ≈ +211.75 % (bug observé)
 * - NVDA : qty totale 332.662614, coût total 19 634 €, cours natif
 *          212.17 USD converti 183.872086 €
 *          → unrealizedPnlPct ≈ +211.5 % (bug observé, même ordre par
 *            coïncidence — deux positions ~triplées, pas un dénominateur
 *            partagé)
 *
 * P1 (2026-09-16) : `getHoldings` exigeait une `AssetDailyClose` exactement
 * datée d'hier (`readDailyCloses(assetIds, yesterdayKey, yesterdayKey)` +
 * lecture stricte). Sur l'audit, la dernière clôture réelle en base datait de
 * 2 jours (collecte en retard) : la variation de séance tombait à `null`
 * pour toutes les lignes, watchlist comprise, alors que la fiche actif (autre
 * source, live) affichait un chiffre. `closeWithinStaleDays` (miroir de
 * `previousCloseNear` dans `spot-history-service.ts`) tolère jusqu'à
 * `MAX_STALE_DAYS` jours de retard avant de rendre `null` — même garde que le
 * KPI crypto 24h.
 */

function dayChangePct(
  priceEur: Decimal.Value,
  prevCloseEur: Decimal.Value | null
): number | null {
  if (prevCloseEur == null) return null;
  const price = new Decimal(priceEur);
  const prev = new Decimal(prevCloseEur);
  if (!price.gt(0) || !prev.gt(0)) return null;
  return price.minus(prev).div(prev).times(100).toNumber();
}

function unrealizedPnlPct(
  marketValueEur: Decimal.Value,
  costBasisEur: Decimal.Value
): number {
  const cost = new Decimal(costBasisEur);
  if (!cost.gt(0)) return 0;
  return new Decimal(marketValueEur).minus(cost).div(cost).times(100).toNumber();
}

describe("watchlist — variation de séance vs P&L latent", () => {
  it("BTC : unrealizedPnlPct reproduit le +211 % observé (coût de revient)", () => {
    const qty = "1.695352";
    const costBasisEur = "35788.85";
    const priceEur = "65804";
    const marketValueEur = new Decimal(qty).times(priceEur);
    const pct = unrealizedPnlPct(marketValueEur, costBasisEur);
    expect(pct).toBeGreaterThan(210);
    expect(pct).toBeLessThan(213);
  });

  it("NVDA : unrealizedPnlPct reproduit le même ordre de grandeur (+211 %), sans rapport avec BTC", () => {
    const qty = "332.662614";
    const costBasisEur = "19634";
    const priceEur = "183.872086"; // 212.17 USD convertis
    const marketValueEur = new Decimal(qty).times(priceEur);
    const pct = unrealizedPnlPct(marketValueEur, costBasisEur);
    expect(pct).toBeGreaterThan(210);
    expect(pct).toBeLessThan(213);
  });

  it("BTC : dayChangePct (cours vs clôture d'hier) donne un ordre de grandeur de marché, pas +211 %", () => {
    // Clôture de la veille plausible pour BTC (variation de séance réaliste).
    const priceEur = "65804";
    const prevCloseEur = "66150"; // repli léger simulé
    const pct = dayChangePct(priceEur, prevCloseEur);
    expect(pct).not.toBeNull();
    expect(Math.abs(pct as number)).toBeLessThan(10);
  });

  it("dayChangePct est null quand la clôture de la veille n'est pas couverte — jamais un repli sur le coût de revient", () => {
    expect(dayChangePct("65804", null)).toBeNull();
  });

  it("closeWithinStaleDays trouve la clôture d'hier quand elle est couverte exactement", () => {
    const closes = new Map<string, number>([
      ["2026-09-14", 66000],
      ["2026-09-15", 66150],
    ]);
    expect(closeWithinStaleDays(closes, "2026-09-15")).toBe(66150);
  });

  it(
    "closeWithinStaleDays tolère un retard de collecte jusqu'à MAX_STALE_DAYS jours " +
      "— reproduit l'audit P1 (dernière clôture réelle 2026-09-13, veille 2026-09-15, " +
      "écart de 2 jours < MAX_STALE_DAYS)",
    () => {
      const closes = new Map<string, number>([["2026-09-13", 62000]]);
      expect(MAX_STALE_DAYS).toBeGreaterThanOrEqual(2);
      expect(closeWithinStaleDays(closes, "2026-09-15")).toBe(62000);
    }
  );

  it("closeWithinStaleDays rend null au-delà de la tolérance — jamais une clôture trop vieille présentée comme celle d'hier", () => {
    const tooOldDay = "2026-09-01"; // bien plus vieux que MAX_STALE_DAYS avant le 15
    const closes = new Map<string, number>([[tooOldDay, 60000]]);
    expect(closeWithinStaleDays(closes, "2026-09-15")).toBeNull();
  });

  it("closeWithinStaleDays rend null sans aucune clôture connue — jamais un repli inventé", () => {
    expect(closeWithinStaleDays(undefined, "2026-09-15")).toBeNull();
    expect(closeWithinStaleDays(new Map(), "2026-09-15")).toBeNull();
  });

  it("agrégation value-weighted au merge multi-plateforme : null si une seule jambe manque sa clôture de la veille", () => {
    // Miroir du bloc merge de service.ts : `prevCloseValueEur` ne s'additionne
    // que si les deux jambes le connaissent, sinon la ligne fusionnée reste
    // `null` plutôt que de fabriquer une base partielle.
    const legA = { marketValueEur: "1000", prevCloseValueEur: "980" as string | null };
    const legB = { marketValueEur: "500", prevCloseValueEur: null as string | null };
    const mergedPrevCloseValueEur =
      legA.prevCloseValueEur != null && legB.prevCloseValueEur != null
        ? new Decimal(legA.prevCloseValueEur).plus(legB.prevCloseValueEur)
        : null;
    expect(mergedPrevCloseValueEur).toBeNull();

    const legC = { marketValueEur: "500", prevCloseValueEur: "490" as string | null };
    const mergedOk =
      legA.prevCloseValueEur != null && legC.prevCloseValueEur != null
        ? new Decimal(legA.prevCloseValueEur).plus(legC.prevCloseValueEur)
        : null;
    expect(mergedOk).not.toBeNull();
    const mv = new Decimal(legA.marketValueEur).plus(legC.marketValueEur);
    const pct = dayChangePct(mv, mergedOk);
    expect(pct).not.toBeNull();
  });
});

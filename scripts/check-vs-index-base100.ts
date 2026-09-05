/**
 * Contrôle live T-4.E — Yahoo ^FCHI (même client que `/api/benchmark`).
 *
 *   npx tsx scripts/check-vs-index-base100.ts
 *
 * CI : les unit tests mockent les deux séries ; ce script n'y tourne pas.
 * Frankfurter n'entre pas dans le rebase (le CAC est déjà en points EUR) :
 * on le ping seulement pour confirmer l'egress déjà utilisé par le FX.
 *
 * Échec : portefeuille plat à +0 % pendant que le CAC bouge — le symptôme
 * d'une NAV en euros posée à côté d'un indice en %. Ancre = premier jour
 * NAV ; overlay off s'il n'existe aucune close ≤ ancre.
 */
import YahooFinance from "yahoo-finance2";
import { rebaseToCommonBase100 } from "@/app/lib/portfolio/vs-index-series";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

async function pingFrankfurter(): Promise<string> {
  const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return `HTTP ${res.status}`;
  const body = (await res.json()) as { rates?: { USD?: number } };
  const usd = body.rates?.USD;
  return typeof usd === "number" ? `EURUSD=${usd}` : "no USD rate";
}

async function fetchCac(from: Date, to: Date) {
  const result = (await yahooFinance.chart("^FCHI", {
    period1: from,
    period2: to,
    interval: "1d",
  })) as {
    quotes?: Array<{
      date?: Date;
      close?: number | null;
      adjclose?: number | null;
    }>;
  };
  return (result.quotes ?? [])
    .filter((q) => q.date && typeof (q.close ?? q.adjclose) === "number")
    .map((q) => {
      const close = Number(q.close ?? q.adjclose);
      return { day: new Date(q.date!).toISOString(), value: close };
    })
    .filter((p) => Number.isFinite(p.value) && p.value > 0);
}

async function main() {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [fx, cac] = await Promise.all([
    pingFrankfurter().catch((e: unknown) => `error: ${String(e)}`),
    fetchCac(from, to),
  ]);

  console.log(`frankfurter: ${fx}`);
  console.log(`yahoo ^FCHI: ${cac.length} closes ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);

  if (cac.length < 4) {
    console.error("FAIL: historique CAC insuffisant");
    process.exit(1);
  }

  /*
    NAV synthétique : 20 × le CAC, plus un drift de +0,4 % à chaque barre.
    Les deux séries bougent, et pas du même pourcentage — si le rebase
    mélangeait euros et %, le portefeuille resterait à 0 ou saturait l'axe.
  */
  const portfolio = cac.map((c, i) => ({
    day: c.day,
    value: 20 * c.value * (1 + 0.004 * i),
  }));

  const series = rebaseToCommonBase100(portfolio, cac);
  const first = series[0]!;
  const last = series[series.length - 1]!;

  console.log(
    `base day=${first.day}  nav0→100  cac0→100  last nav=${last.portfolioBase100.toFixed(3)}  last cac=${last.indexBase100?.toFixed(3)}`
  );
  console.log(
    `pct  portfolio=${last.portfolioPct.toFixed(3)} %  cac=${last.benchmarkPct?.toFixed(3)} %`
  );

  const cacMoved = Math.abs(last.benchmarkPct ?? 0) > 0.05;
  const portFlat = Math.abs(last.portfolioPct) < 1e-9;
  if (cacMoved && portFlat) {
    console.error("FAIL: portefeuille plat +0 % pendant que le CAC bouge");
    process.exit(1);
  }
  if (first.portfolioBase100 !== 100 || first.indexBase100 !== 100) {
    console.error("FAIL: le jour commun n'est pas à 100 / 100");
    process.exit(1);
  }
  if (
    last.portfolioBase100 != null &&
    (last.portfolioBase100 < 50 || last.portfolioBase100 > 200)
  ) {
    console.error("FAIL: la NAV n'est pas une base 100 (unités mélangées ?)");
    process.exit(1);
  }
  console.log("OK — les deux courbes quittent 100 sur la fenêtre commune");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { prisma } from "../prisma";
import { d, toFixed, zero } from "../money/decimal";
import { convertFromEurSync, convertToEurSync, getEurRates } from "../market/fx";
import { positiveCashOnly, savingsDisplayBalance, type RateType, type PayoutFrequency } from "../money/savings";
import {
  applyDueInterestForUser,
  mapSavingsRowForApi,
} from "../money/savings-accrual";

/**
 * Sum all explicit cash pockets that have balance > 0 only.
 * Does NOT include ledger APPORT cash (legacy) — banks tab is the source of truth.
 */
export async function getExplicitCashTotalEur(userId: string) {
  const rates = await getEurRates();
  let total = zero();

  const [banks, savings, envelopes, avs] = await Promise.all([
    prisma.bankAccount.findMany({ where: { userId } }),
    prisma.savingsAccount.findMany({ where: { userId } }),
    prisma.envelopeCash.findMany({ where: { userId } }),
    prisma.lifeInsurance.findMany({
      where: { userId },
      include: { products: true },
    }),
  ]);

  for (const b of banks) {
    if (!positiveCashOnly(b.balance.toString())) continue;
    total = total.plus(d(convertToEurSync(b.balance.toString(), b.currency, rates)));
  }

  for (const s of savings) {
    const rateType = (s.rateType === "APR" ? "APR" : "APY") as RateType;
    const freq = (
      ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(s.payoutFrequency || "")
        ? s.payoutFrequency
        : "DAILY"
    ) as PayoutFrequency;
    const clock = s.lastPayoutAt || s.lastAccruedAt;
    const { displayBalance } = savingsDisplayBalance(
      s.balance.toString(),
      s.apyPercent.toString(),
      clock,
      new Date(),
      rateType,
      freq
    );
    if (!positiveCashOnly(displayBalance)) continue;
    total = total.plus(d(convertToEurSync(displayBalance, s.currency, rates)));
  }

  for (const e of envelopes) {
    if (!positiveCashOnly(e.balance.toString())) continue;
    total = total.plus(d(convertToEurSync(e.balance.toString(), e.currency, rates)));
  }

  for (const av of avs) {
    if (positiveCashOnly(av.cashEuro.toString())) {
      total = total.plus(d(convertToEurSync(av.cashEuro.toString(), av.currency, rates)));
    }
    for (const p of av.products) {
      if (!positiveCashOnly(p.currentValue.toString())) continue;
      total = total.plus(d(convertToEurSync(p.currentValue.toString(), p.currency, rates)));
    }
  }

  return { totalEur: total, rates };
}

export async function listBankAccounts(userId: string, base = "EUR") {
  const rates = await getEurRates();
  const rows = await prisma.bankAccount.findMany({
    where: { userId },
    orderBy: { bankName: "asc" },
  });
  return rows.map((b) => {
    const bal = b.balance.toString();
    const counts = positiveCashOnly(bal);
    return {
      id: b.id,
      bankName: b.bankName,
      balance: bal,
      currency: b.currency,
      notes: b.notes,
      countsInNetWorth: counts,
      balanceBase: counts
        ? convertFromEurSync(convertToEurSync(bal, b.currency, rates), base, rates)
        : "0",
    };
  });
}

export async function listSavingsAccounts(userId: string, base = "EUR") {
  // Credit any due interest before listing (daily automation trigger)
  await applyDueInterestForUser(userId);

  const rates = await getEurRates();
  const rows = await prisma.savingsAccount.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
  return rows.map((s) => {
    const mapped = mapSavingsRowForApi(s);
    const counts = positiveCashOnly(mapped.displayBalance);
    return {
      ...mapped,
      countsInNetWorth: counts,
      displayBalanceBase: counts
        ? convertFromEurSync(
            convertToEurSync(mapped.displayBalance, s.currency, rates),
            base,
            rates
          )
        : "0",
    };
  });
}

export async function listLifeInsurances(userId: string, base = "EUR") {
  const rates = await getEurRates();
  const rows = await prisma.lifeInsurance.findMany({
    where: { userId },
    include: { products: true },
    orderBy: { insurer: "asc" },
  });
  return rows.map((av) => {
    const products = av.products.map((p) => ({
      id: p.id,
      name: p.name,
      currentValue: p.currentValue.toString(),
      currency: p.currency,
      notes: p.notes,
      valueBase: positiveCashOnly(p.currentValue.toString())
        ? convertFromEurSync(
            convertToEurSync(p.currentValue.toString(), p.currency, rates),
            base,
            rates
          )
        : "0",
    }));
    const productsTotal = products.reduce(
      (acc, p) => acc.plus(d(p.currentValue)),
      zero()
    );
    const cash = av.cashEuro.toString();
    return {
      id: av.id,
      insurer: av.insurer,
      openDate: av.openDate?.toISOString() ?? null,
      cashEuro: cash,
      currency: av.currency,
      notes: av.notes,
      products,
      cashCounts: positiveCashOnly(cash),
      cashBase: positiveCashOnly(cash)
        ? convertFromEurSync(convertToEurSync(cash, av.currency, rates), base, rates)
        : "0",
      productsTotal: toFixed(productsTotal, 8),
    };
  });
}

export async function getOrCreateEnvelopeCash(
  userId: string,
  envelope: "CTO" | "PEA" | "AV"
) {
  const existing = await prisma.envelopeCash.findUnique({
    where: { userId_envelope: { userId, envelope } },
  });
  if (existing) return existing;
  return prisma.envelopeCash.create({
    data: {
      userId,
      envelope,
      balance: 0,
      currency: envelope === "PEA" ? "EUR" : "EUR",
    },
  });
}

export async function listEnvelopeCash(userId: string, base = "EUR") {
  const rates = await getEurRates();
  // Ensure the three envelopes exist
  await Promise.all([
    getOrCreateEnvelopeCash(userId, "CTO"),
    getOrCreateEnvelopeCash(userId, "PEA"),
    getOrCreateEnvelopeCash(userId, "AV"),
  ]);
  const rows = await prisma.envelopeCash.findMany({ where: { userId } });
  return rows.map((e) => {
    const bal = e.balance.toString();
    const counts = positiveCashOnly(bal);
    return {
      id: e.id,
      envelope: e.envelope,
      balance: bal,
      currency: e.currency,
      countsInNetWorth: counts,
      balanceBase: counts
        ? convertFromEurSync(convertToEurSync(bal, e.currency, rates), base, rates)
        : "0",
    };
  });
}

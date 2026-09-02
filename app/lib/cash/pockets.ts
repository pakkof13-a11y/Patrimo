import { prisma } from "../prisma";
import { d, toFixed, zero, type Decimal } from "../money/decimal";
import { convertFromEurSync, convertToEurSync, getEurRates } from "../market/fx";
import { savingsDisplayBalance, type RateType, type PayoutFrequency } from "../money/savings";
import {
  applyDueInterestForUser,
  mapSavingsRowForApi,
} from "../money/savings-accrual";
import { normalizePlatformSearch } from "../platforms/presets";

/**
 * Somme des poches de trésorerie saisies, **avec leur signe**.
 *
 * N'inclut pas le cash APPORT du journal (legacy) — l'onglet Banques est la
 * source de vérité.
 *
 * ## La règle de signe, et pourquoi elle a changé
 *
 * Ces sommes ignoraient tout solde non strictement positif. Un compte courant
 * à −2 000 € comptait donc pour 0 dans le patrimoine net, alors même que
 * l'écran affichait bien −2 000 €.
 *
 * Le chargeur historique, lui, a toujours transmis les soldes signés
 * (`historical/load.ts`). Les deux moitiés du produit répondaient donc
 * différemment à la même question, et la courbe décrochait de la carte du jour
 * du montant du découvert — exactement la marche que le moteur de valorisation
 * dit exister pour supprimer.
 *
 * Trois faits ont tranché :
 *
 * 1. un solde de −2 000 € est une information **certaine**, pas une absence.
 *    Le refus de compter s'applique à ce qu'on ignore, jamais à ce qu'on sait ;
 * 2. rien d'autre ne rattrape un découvert. `Liability` est bâti pour un prêt
 *    amortissable — capital initial, capital restant, mensualité, échéances —
 *    n'a aucune catégorie de découvert et aucun lien vers `BankAccount`.
 *    Exclure le négatif faisait donc disparaître une dette réelle du
 *    patrimoine, qui s'en trouvait surévalué ;
 * 3. aligner le direct sur l'historique est le plus petit des deux changements,
 *    et le seul qui rende la courbe et la carte comparables.
 *
 * Un solde **inconnu** reste inconnu : ce module ne voit que des soldes saisis.
 */
export async function getExplicitCashTotalEur(userId: string) {
  const rates = await getEurRates();
  let total = zero();

  const [banks, savings, envelopes] = await Promise.all([
    prisma.bankAccount.findMany({ where: { userId } }),
    prisma.savingsAccount.findMany({ where: { userId } }),
    prisma.envelopeCash.findMany({ where: { userId } }),
  ]);

  for (const b of banks) {
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
    total = total.plus(d(convertToEurSync(displayBalance, s.currency, rates)));
  }

  for (const e of envelopes) {
    total = total.plus(d(convertToEurSync(e.balance.toString(), e.currency, rates)));
  }

  // L'assurance-vie n'entre PAS ici.
  //
  // Elle y entrait, et cela produisait trois erreurs mesurables : un support
  // saisi à la fois dans la table AV et au journal comptait deux fois dans le
  // patrimoine net ; une UC actions se retrouvait rangée dans « Cash », faussant
  // l'allocation par classe ; et le fonds euro du contrat, également listé comme
  // produit, se comptait lui-même deux fois.
  //
  // Les supports d'AV sont désormais des positions du journal comme les autres
  // (cf. `life-insurance/migrate-to-ledger.ts`), donc déjà comptés par
  // `marketValue`. Les additionner ici les compterait une seconde fois.

  return { totalEur: total, rates };
}

/**
 * Cash explicite (comptes + livrets) agrégé par nom de banque normalisé → EUR.
 * Utilisé pour rattacher le solde banque à une plateforme du même nom (ex. Revolut).
 */
export async function getBankPocketCashByNameEur(
  userId: string,
  rates?: Record<string, number>
): Promise<Map<string, Decimal>> {
  const fx = rates ?? (await getEurRates());
  const byName = new Map<string, Decimal>();

  // Même règle de signe que le total : la poche d'une banque vaut ce qu'elle
  // vaut, découvert compris. Elle valait 0, ce qui la disait vide.
  const add = (bankName: string | null | undefined, amountEur: Decimal) => {
    if (!bankName?.trim()) return;
    const key = normalizePlatformSearch(bankName);
    if (!key) return;
    byName.set(key, (byName.get(key) || zero()).plus(amountEur));
  };

  const [banks, savings] = await Promise.all([
    prisma.bankAccount.findMany({ where: { userId } }),
    prisma.savingsAccount.findMany({ where: { userId } }),
  ]);

  for (const b of banks) {
    const eur = d(convertToEurSync(b.balance.toString(), b.currency, fx));
    add(b.bankName, eur);
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
    // Livret sans banque de détention : compte dans le cash global, pas sur une plateforme
    if (!s.bankName?.trim()) continue;
    const eur = d(convertToEurSync(displayBalance, s.currency, fx));
    add(s.bankName, eur);
  }

  return byName;
}

export async function listBankAccounts(userId: string, base = "EUR") {
  const rates = await getEurRates();
  const rows = await prisma.bankAccount.findMany({
    where: { userId },
    orderBy: { bankName: "asc" },
  });
  return rows.map((b) => {
    const bal = b.balance.toString();
    return {
      id: b.id,
      bankName: b.bankName,
      balance: bal,
      currency: b.currency,
      notes: b.notes,
      isPro: b.isPro,
      ownershipPct: b.ownershipPct?.toString() ?? null,
      /*
        Conservé, et désormais toujours vrai : un solde saisi entre dans le
        patrimoine, quel que soit son signe. Le champ reste au contrat pour ne
        pas casser ses consommateurs, mais il ne sert plus à écarter personne.
      */
      countsInNetWorth: true,
      balanceBase: convertFromEurSync(
        convertToEurSync(bal, b.currency, rates),
        base,
        rates
      ),
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
    return {
      ...mapped,
      countsInNetWorth: true,
      displayBalanceBase: convertFromEurSync(
        convertToEurSync(mapped.displayBalance, s.currency, rates),
        base,
        rates
      ),
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
      valueBase: convertFromEurSync(
        convertToEurSync(p.currentValue.toString(), p.currency, rates),
        base,
        rates
      ),
    }));
    const productsTotal = products.reduce(
      (acc, p) => acc.plus(d(p.currentValue)),
      zero()
    );
    const cash = av.cashEuro.toString();
    const premiumsBefore2017Eur = av.premiumsBefore2017Eur.toString();
    const premiumsAfter2017Eur = av.premiumsAfter2017Eur.toString();
    // Encours « connu » du contrat (legacy cash + produits) — le journal
    // des supports s'y ajoute côté API si fourni.
    const outstandingEur = toFixed(d(cash).plus(productsTotal), 8);
    return {
      id: av.id,
      insurer: av.insurer,
      openDate: av.openDate?.toISOString() ?? null,
      cashEuro: cash,
      currency: av.currency,
      notes: av.notes,
      premiumsBefore2017Eur,
      premiumsAfter2017Eur,
      premiumsTotalEur: toFixed(
        d(premiumsBefore2017Eur).plus(d(premiumsAfter2017Eur)),
        8
      ),
      outstandingEur,
      products,
      cashCounts: true,
      cashBase: convertFromEurSync(
        convertToEurSync(cash, av.currency, rates),
        base,
        rates
      ),
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
    return {
      id: e.id,
      envelope: e.envelope,
      balance: bal,
      currency: e.currency,
      countsInNetWorth: true,
      balanceBase: convertFromEurSync(
        convertToEurSync(bal, e.currency, rates),
        base,
        rates
      ),
    };
  });
}

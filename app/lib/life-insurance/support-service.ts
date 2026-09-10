/**
 * Création et mise à jour des supports d'un contrat d'assurance-vie.
 *
 * Un support entre au patrimoine **par le journal**, comme tout le reste : la
 * saisie produit un actif, ses caractéristiques, et une transaction d'achat.
 * C'est ce qui lui donne un prix de revient, donc une plus-value — ce qu'une
 * valorisation posée dans un champ à côté du journal ne permettait pas.
 *
 * ## Quantité 1 × valeur
 *
 * Un contrat d'assurance-vie ne communique pas un nombre de parts pour ses UC :
 * il annonce un montant investi et une valorisation. On pose donc `quantity = 1`
 * et `unitPrice = montant`, comme l'immobilier pose la quote-part en quantité.
 * Réévaluer le support revient à mettre à jour son `manualPrice`.
 *
 * Les UC dont on connaît réellement le nombre de parts et la valeur liquidative
 * peuvent être saisies par le journal habituel : rien n'interdit une quantité
 * différente de 1, ce service n'est qu'un raccourci de saisie.
 *
 * ## L'unité de ce « montant »
 *
 * La saisie est **en euros** des deux côtés (`amountEur`, `valueEur`). Les deux
 * champs écrits, eux, sont dans la **devise de l'actif** : voir `writeFx`, qui
 * porte la conversion et le taux persisté avec elle.
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { convertFromEurSync, FxRateUnknownError, getEurRates } from "../market/fx";
import { d, toFixed } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { assetClassForKind, isStructured } from "./constants";

export class LifeInsuranceInputError extends Error {}

/** Type de plateforme portant les contrats d'assurance-vie. */
export const LIFE_INSURANCE_PLATFORM_TYPE = "ASSURANCE_VIE";

export type CreateSupportInput = {
  /** Contrat de rattachement. */
  lifeInsuranceId: string;
  /** Libellé du support tel qu'il figure au relevé. */
  name: string;
  /** FONDS_EURO | UC | STRUCTURED */
  kind: string;
  /** Montant investi, en euros. */
  amountEur: string;
  /** Frais d'entrée effectivement supportés, en euros. */
  entryFeesEur?: string | null;
  /** Date du versement. À défaut, l'ouverture du contrat. */
  investedAt?: string | null;

  isin?: string | null;
  issuer?: string | null;

  // Produit structuré
  underlying?: string | null;
  nominalEur?: string | null;
  strikeLevel?: string | null;
  couponRatePct?: string | null;
  couponFrequency?: string | null;
  couponBarrierPct?: string | null;
  couponMemory?: boolean | null;
  autocallBarrierPct?: string | null;
  capitalProtectionPct?: string | null;
  strikeDate?: string | null;
  maturityDate?: string | null;
  nextObservationDate?: string | null;
  entryFeePct?: string | null;
  managementFeePct?: string | null;

  notes?: string | null;
};

function parseOptionalDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dec(raw?: string | null): Prisma.Decimal | null {
  if (raw == null || String(raw).trim() === "") return null;
  const normalized = String(raw).replace(",", ".").trim();
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(normalized);
}

/**
 * Table de taux d'une écriture en euros.
 *
 * `writeFx` n'y touche pas — un euro vaut un euro — et elle n'existe que pour
 * éviter de rendre `rates` nullable sur un chemin où rien ne se convertit.
 * Surtout : elle ne doit **jamais** partir vers `getHoldings`, qui valorise
 * tous les actifs de l'utilisateur et lèverait sur le premier en devise.
 */
const RATES_EUR_ONLY: Record<string, number> = { EUR: 1 };

type WriteFx = {
  /** Un montant saisi en euros, exprimé dans la devise de l'actif. */
  toNative: (amountEur: Prisma.Decimal) => Prisma.Decimal;
  /** `Transaction.fxRateToEur` : ce que vaut une unité de devise en euros. */
  fxRateToEur: string;
};

/**
 * Conversion de la saisie vers la devise de l'actif, et le taux qui l'accompagne.
 *
 * ## Le défaut corrigé
 *
 * Ce fichier reçoit des euros et écrivait des euros dans deux champs qui n'en
 * attendent pas. `getHoldings` lit `manualPrice` comme un prix **dans
 * `asset.currency`** puis le convertit (`portfolio/service.ts:338-340`), et le
 * rejeu convertit `unitPrice` par `fxRateToEur` (`accounting/ledger.ts`). Un
 * montant euro posé là subissait donc un change qu'il ne demandait pas.
 *
 * Mesuré sur un contrat en dollars, 10 000 € saisis au taux 1,08 : coût de
 * revient 9 259,26 €, valeur 9 259,26 €, plus-value nulle. Les deux côtés
 * fautifs du même écart — 740,74 € de position manquante qu'aucune plus-value
 * ne trahissait. Ne corriger que la réévaluation aurait fabriqué exactement
 * +740,74 € de gain.
 *
 * ## Un seul relevé de taux par écriture
 *
 * `rates` est **passé**, jamais rechargé. `fxRateToEur()` de `market/fx` ferait
 * un second `getEurRates()` : deux appels de part et d'autre de l'expiration du
 * cache (une heure) rendent deux taux, la saisie serait convertie par l'un et
 * relue par l'autre. 0,1 % de mouvement EUR/USD vaut 10 € sur 10 000 €, qui
 * s'afficheraient en plus-value le jour même de la saisie.
 *
 * Le taux vient de `convertFromEurSync(1, …, rates)` et non de `rates[cur]` lu
 * en direct : `rateOf` est le seul juge de ce qu'est un taux fondé — taux
 * servi, table déclarée, ou rien — et deux lectures indépendantes de la même
 * table peuvent en juger différemment (valeur nulle, négative ou non finie
 * d'un fournisseur bavard). Une seule porte, donc, pour la conversion et pour
 * le taux persisté.
 *
 * ## Devise hors des cinq couvertes
 *
 * `LifeInsuranceInputError`, que les routes traduisent en 400 — pas un 500.
 * C'est déjà le code que `resolveFx` produit pour la même condition sur la
 * même écriture (`AccountingError("FX_RATE_UNKNOWN")`), et `clientErrorStatus`
 * ne connaît que 400 et 500 : un 500 annoncerait une panne là où la saisie est
 * simplement hors du périmètre couvert.
 */
function writeFx(currency: string, rates: Record<string, number>): WriteFx {
  const cur = (currency || "EUR").toUpperCase();
  if (cur === "EUR") {
    return { toNative: (amountEur) => amountEur, fxRateToEur: "1" };
  }

  const refuse = () =>
    new LifeInsuranceInputError(
      `Taux EUR→${cur} indisponible : aucune source ne le fonde. La saisie en ` +
        "euros ne peut pas être convertie dans la devise du support — rien " +
        "n'a été enregistré."
    );

  let oneEurInNative: string;
  try {
    oneEurInNative = convertFromEurSync(1, cur, rates);
  } catch (e) {
    if (e instanceof FxRateUnknownError) throw refuse();
    throw e;
  }
  const rate = d(oneEurInNative);
  // `rateOf` garantit un taux strictement positif ; on ne divise pas par sa
  // parole seule — un zéro écrirait un `fxRateToEur` infini en base.
  if (rate.lte(0)) throw refuse();

  return {
    toNative: (amountEur) =>
      new Prisma.Decimal(convertFromEurSync(amountEur.toString(), cur, rates)),
    fxRateToEur: toFixed(d(1).div(rate), 10),
  };
}

export type CreateSupportResult = {
  assetId: string;
  supportId: string;
  transactionId: string;
};

/**
 * Crée un support : actif, caractéristiques et versement, en une transaction.
 *
 * Atomique par nécessité : un actif sans transaction serait une position
 * fantôme, valorisée mais sans prix de revient, et le patrimoine afficherait une
 * plus-value égale à sa valeur entière.
 */
export async function createSupport(
  userId: string,
  input: CreateSupportInput
): Promise<CreateSupportResult> {
  const name = input.name.trim();
  if (!name) throw new LifeInsuranceInputError("Nom du support requis");

  const amount = dec(input.amountEur);
  if (!amount || amount.lte(0)) {
    throw new LifeInsuranceInputError("Montant investi requis (> 0)");
  }

  const contract = await prisma.lifeInsurance.findFirst({
    where: { id: input.lifeInsuranceId, userId },
    select: { id: true, insurer: true, openDate: true, currency: true },
  });
  if (!contract) throw new LifeInsuranceInputError("Contrat introuvable");

  // Un structuré sans échéance n'en est pas un : c'est le terme qui commande le
  // remboursement du capital. On l'exige plutôt que d'afficher plus tard une
  // fiche muette sur le seul point qui compte.
  if (isStructured(input.kind) && !parseOptionalDate(input.maturityDate)) {
    throw new LifeInsuranceInputError(
      "Date d'échéance requise pour un produit structuré"
    );
  }

  const platformId = await ensurePlatform(userId, contract.insurer);
  // Date du versement : aujourd'hui à défaut, **pas** l'ouverture du contrat.
  //
  // Retomber sur l'ouverture paraissait plus utile — le support existe souvent
  // depuis longtemps — mais datait un versement saisi ce matin de plusieurs
  // années en arrière, à sa valeur du jour. La courbe d'évolution montrait
  // alors ce montant comme détenu depuis l'ouverture, gonflant le patrimoine
  // passé d'argent qui n'y était pas. Sous-estimer la durée de détention est
  // moins grave que fabriquer un historique.
  const occurredAt = parseOptionalDate(input.investedAt) ?? new Date();
  // La devise de l'actif se décide ici, et c'est celle du contrat **à cet
  // instant**. Partout ailleurs c'est `asset.currency` qui fait foi : un
  // contrat peut changer de devise après coup, un actif déjà créé non.
  const currency = (contract.currency || "EUR").toUpperCase();
  const structured = isStructured(input.kind);
  const entryFees = dec(input.entryFeesEur) ?? new Prisma.Decimal(0);

  /*
    Conversion **avant** `prisma.$transaction`, pour deux raisons : aucun appel
    sortant à l'intérieur d'une transaction interactive, qui tiendrait la
    connexion ouverte le temps du réseau ; et une devise sans taux fondé doit
    faire échouer la saisie sans avoir rien écrit — ni actif, ni fiche, ni
    versement.

    Aucun appel du tout pour un contrat en euros : il n'y a rien à convertir,
    et `resolveFx` fait le même retour immédiat côté transactions.
  */
  const rates = currency === "EUR" ? RATES_EUR_ONLY : await getEurRates();
  const fx = writeFx(currency, rates);
  const amountNative = fx.toNative(amount);
  /*
    Les frais suivent le montant, sinon le journal les lit en devise :
    `accounting/ledger.ts` fait `feesEur = fees × fxRateToEur`, et 50 € partis
    tels quels dans une transaction en dollars revenaient à 46,30 €. Mesuré
    après conversion : 54 USD × 0,9259259259 = 50,00000000 €.

    Conséquence assumée sur l'invariant : le CUMP capitalise les frais
    d'acquisition (`accounting/cump.ts`), donc un support fraîchement saisi
    affiche **−frais** de plus-value latente, jamais zéro dès que les frais ne
    sont pas nuls. C'est la règle du prix de revient, pas un écart de change.
  */
  const feesNative = fx.toNative(entryFees);

  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        userId,
        platformId,
        name,
        isin: input.isin?.trim() || null,
        assetClass: assetClassForKind(input.kind),
        accountType: "AV",
        currency,
        // Aucune cotation publique pour une UC ou un structuré : la valeur est
        // celle du relevé, saisie puis réévaluée à la main.
        priceProvider: "MANUAL",
        // Prix **unitaire dans la devise de l'actif** — aucune division ici :
        // `quantity` vaut 1 par construction sur ce chemin, et aucune quantité
        // n'y est saisissable. Le diviseur n'a de sens qu'à la réévaluation,
        // où la quantité vient du journal et peut valoir 0,6 après un rachat.
        manualPrice: amountNative,
        acquisitionDate: occurredAt,
        notes: input.notes?.trim() || null,
      },
      select: { id: true },
    });

    const support = await tx.lifeInsuranceSupport.create({
      data: {
        assetId: asset.id,
        lifeInsuranceId: contract.id,
        kind: input.kind,
        isin: input.isin?.trim() || null,
        issuer: input.issuer?.trim() || null,

        // Les caractéristiques de structuré ne sont écrites que pour un
        // structuré : les conserver sur une UC laisserait des barrières
        // orphelines qu'un affichage finirait par prendre au sérieux.
        underlying: structured ? input.underlying?.trim() || null : null,
        // `amount`, la saisie en euros — jamais `amountNative`. Ce champ est
        // relu comme un montant en euros par `coupon-schedule.ts` : le repli
        // sur le montant converti annoncerait « 10 800 € » de nominal pour un
        // structuré de 10 000 € dans un contrat en dollars.
        nominalEur: structured ? dec(input.nominalEur) ?? amount : null,
        strikeLevel: structured ? dec(input.strikeLevel) : null,
        couponRatePct: structured ? dec(input.couponRatePct) : null,
        couponFrequency: structured
          ? input.couponFrequency || "ANNUAL"
          : "ANNUAL",
        couponBarrierPct: structured ? dec(input.couponBarrierPct) : null,
        couponMemory: structured ? Boolean(input.couponMemory) : false,
        autocallBarrierPct: structured ? dec(input.autocallBarrierPct) : null,
        capitalProtectionPct: structured
          ? dec(input.capitalProtectionPct)
          : null,
        strikeDate: structured ? parseOptionalDate(input.strikeDate) : null,
        maturityDate: structured ? parseOptionalDate(input.maturityDate) : null,
        nextObservationDate: structured
          ? parseOptionalDate(input.nextObservationDate)
          : null,

        entryFeePct: dec(input.entryFeePct),
        managementFeePct: dec(input.managementFeePct),
        notes: input.notes?.trim() || null,
      },
      select: { id: true },
    });

    const created = await createTransaction(
      {
        userId,
        type: "ACHAT",
        platformId,
        assetId: asset.id,
        quantity: "1",
        unitPrice: amountNative.toString(),
        fees: feesNative.toString(),
        currency,
        /*
          Le taux vivant, plus « 1 ».

          `resolveFx` ne force le taux historique que sur les revenus : un
          ACHAT en devise portant un taux fourni le garde tel quel. Un « 1 »
          était donc conservé jusqu'en base pour une devise étrangère — un
          dollar valant un euro, écrit comme un fait. Le taux transmis ici est
          celui qui a converti le montant deux lignes plus haut, tiré du même
          relevé : le journal et la valorisation retombent sur le même euro.
        */
        fxRateToEur: fx.fxRateToEur,
        occurredAt: occurredAt.toISOString(),
        // Le versement provient du contrat, pas d'un compte espèces suivi ici :
        // exiger une trésorerie disponible bloquerait une saisie légitime.
        allowNegativeCash: true,
        notes: input.notes?.trim() || null,
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );

    return {
      assetId: asset.id,
      supportId: support.id,
      transactionId: (created as { id: string }).id,
    };
  });
}

/** Plateforme d'assurance-vie du même nom que l'assureur, créée si absente. */
async function ensurePlatform(userId: string, insurer: string): Promise<string> {
  const name = insurer.trim().slice(0, 120) || "Assurance-vie";
  const existing = await prisma.platform.findFirst({
    where: { userId, name, type: LIFE_INSURANCE_PLATFORM_TYPE },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.platform.create({
    data: { userId, name, type: LIFE_INSURANCE_PLATFORM_TYPE },
    select: { id: true },
  });
  return created.id;
}

/**
 * Réévalue un support à la valeur **totale** du relevé.
 *
 * Le relevé d'assurance-vie annonce un encours par support, pas un prix
 * unitaire. On divise donc par la quantité détenue pour retrouver le prix
 * qu'attend `manualPrice` : écrire le total tel quel multiplierait la position
 * par sa quantité — un fonds euro de 25 000 parts passerait de 25 500 € à
 * 637 millions.
 *
 * **La quantité vient de `getHoldings`, jamais d'une somme de transactions.**
 * L'ancien diviseur était
 * `transaction.aggregate({ _sum: { quantity: true } })`, qui additionne les
 * quantités de *tous* les types. Or `createTransaction` exige une quantité
 * positive pour une VENTE comme pour un ACHAT, et le moteur de position la
 * retranche (`accounting/cump.ts`) : l'agrégat additionnait donc ce que le
 * moteur soustrait. Un `SPLIT`, dont le ratio est stocké en quantité, la
 * corrompait de la même façon.
 *
 * Mesuré : position de 1, rachat partiel de 0,4 saisi en VENTE. Quantité
 * détenue 0,6, agrégat 1,4. Un relevé à 10 000 € écrivait donc
 * `manualPrice = 7 142,86`, et la position valait ensuite
 * `0,6 × 7 142,86 = 4 285,71 €` — le contraire du seul but de cette fonction,
 * qui est que la position vaille exactement le montant du relevé.
 *
 * Seul le prix bouge. La quantité et le prix de revient viennent du journal et
 * restent intacts, sinon la plus-value se dissoudrait à chaque mise à jour.
 *
 * **`totalValueEur` est en euros, `manualPrice` est en devise de l'actif** :
 * la conversion passe par `writeFx`, exactement comme à la création. Écrire
 * l'euro tel quel sur un contrat en dollars sous-évaluait la position de
 * 740,74 € pour 10 000 € de relevé.
 */
export async function revalueSupport(
  userId: string,
  assetId: string,
  totalValueEur: string
): Promise<void> {
  const total = dec(totalValueEur);
  if (!total || total.lt(0)) {
    throw new LifeInsuranceInputError("Valorisation invalide");
  }

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId, accountType: "AV" },
    // `currency` : celle de l'**actif**, jamais celle du contrat. Le contrat
    // peut avoir changé de devise depuis la création du support ; le prix
    // stocké, lui, reste relu dans la devise de l'actif par `getHoldings`.
    select: { id: true, currency: true },
  });
  if (!asset) throw new LifeInsuranceInputError("Support introuvable");

  /*
    Un seul relevé de taux pour l'écriture entière.

    Il convertit la saisie et il alimente les positions lues juste après.
    `getHoldings` l'accepte en troisième argument précisément pour ça : le
    laisser charger le sien autoriserait la quantité, le prix relu et le
    montant écrit à venir de deux relevés différents.

    Résolu avant `getHoldings` : une devise que rien ne fonde doit échouer sans
    avoir payé les cinq allers-retours du calcul de positions.
  */
  const rates = await getEurRates();
  const fx = writeFx(asset.currency || "EUR", rates);

  /*
    La quantité détenue, celle que le moteur de position calcule.

    `getHoldings` applique la même règle que la valorisation qui suivra la
    réévaluation : c'est la seule façon que `quantité × manualPrice` retombe
    sur le montant du relevé. `listSupports` lit déjà cette même source.

    Import dynamique par symétrie avec `listSupports` et `migrate-to-ledger`,
    qui lisent la même source. Ce n'est **pas** une parade à un cycle : rien
    dans `portfolio/service` ne remonte jusqu'ici — sa seule attache à cette
    poche est `patrimony-metrics` → `life-insurance/reconcile`, qui n'importe
    rien — et `performance-service` l'importe statiquement sans dommage. Ce
    n'est pas non plus une économie de chargement : `transactions/service`,
    importé en tête de ce fichier, importe déjà `portfolio/service` pour
    `loadLedgerForUser`.

    Coût réel de cet appel, à compter comme tel : les taux de change (un
    `fetch` borné à 2,5 s, servi par cache et repli), deux requêtes indexées
    d'empreinte du journal, un scan des transactions si le cache de journal
    est froid, puis les actifs avec leurs quatre relations. Cinq allers-retours
    là où l'agrégat n'en faisait qu'un — acceptable sur une écriture déclenchée
    à la main, et c'est déjà ce que l'écran qui porte le bouton (`listSupports`)
    paie à chaque affichage.
  */
  const { getHoldings } = await import("../portfolio/service");
  const holdings = await getHoldings(userId, "EUR", rates);
  const holding = holdings.find((h) => h.assetId === assetId);
  const quantity = new Prisma.Decimal(holding?.quantity ?? 0);

  // Position soldée : aucune quantité à valoriser, et diviser par zéro
  // écrirait un prix infini.
  if (quantity.lte(0)) {
    throw new LifeInsuranceInputError(
      "Support sans quantité — réévaluation impossible"
    );
  }

  // Saisie en euros → devise de l'actif, puis division par la quantité : les
  // deux règles s'appliquent dans cet ordre, et `quantité × manualPrice`
  // reconverti retombe sur le montant du relevé.
  await prisma.asset.update({
    where: { id: asset.id },
    data: { manualPrice: fx.toNative(total).div(quantity) },
  });

  // Le cache de cotation prime sur `manualPrice` dans le calcul des positions
  // (cf. `getHoldings`) : le laisser en place rendait la réévaluation sans
  // effet, tout en répondant « enregistré ». On le purge, comme le fait la
  // valorisation manuelle d'un bien immobilier.
  await prisma.priceQuote.deleteMany({ where: { assetId } });
}

/** Met à jour les caractéristiques d'un support, sans toucher au journal. */
export async function updateSupportDetails(
  userId: string,
  assetId: string,
  patch: Partial<CreateSupportInput>
): Promise<void> {
  const support = await prisma.lifeInsuranceSupport.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true, kind: true },
  });
  if (!support) throw new LifeInsuranceInputError("Support introuvable");

  const data: Prisma.LifeInsuranceSupportUpdateInput = {};
  if (patch.issuer !== undefined) data.issuer = patch.issuer?.trim() || null;
  if (patch.isin !== undefined) data.isin = patch.isin?.trim() || null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  if (patch.entryFeePct !== undefined) data.entryFeePct = dec(patch.entryFeePct);
  if (patch.managementFeePct !== undefined) {
    data.managementFeePct = dec(patch.managementFeePct);
  }

  // Les champs de structuré ne sont modifiables que sur un structuré.
  if (isStructured(support.kind)) {
    if (patch.underlying !== undefined) {
      data.underlying = patch.underlying?.trim() || null;
    }
    if (patch.nominalEur !== undefined) data.nominalEur = dec(patch.nominalEur);
    if (patch.strikeLevel !== undefined) {
      data.strikeLevel = dec(patch.strikeLevel);
    }
    if (patch.couponRatePct !== undefined) {
      data.couponRatePct = dec(patch.couponRatePct);
    }
    if (patch.couponFrequency !== undefined && patch.couponFrequency) {
      data.couponFrequency = patch.couponFrequency;
    }
    if (patch.couponBarrierPct !== undefined) {
      data.couponBarrierPct = dec(patch.couponBarrierPct);
    }
    if (patch.couponMemory !== undefined) {
      data.couponMemory = Boolean(patch.couponMemory);
    }
    if (patch.autocallBarrierPct !== undefined) {
      data.autocallBarrierPct = dec(patch.autocallBarrierPct);
    }
    if (patch.capitalProtectionPct !== undefined) {
      data.capitalProtectionPct = dec(patch.capitalProtectionPct);
    }
    if (patch.strikeDate !== undefined) {
      data.strikeDate = parseOptionalDate(patch.strikeDate);
    }
    if (patch.maturityDate !== undefined) {
      data.maturityDate = parseOptionalDate(patch.maturityDate);
    }
    if (patch.nextObservationDate !== undefined) {
      data.nextObservationDate = parseOptionalDate(patch.nextObservationDate);
    }
  }

  await prisma.lifeInsuranceSupport.update({
    where: { id: support.id },
    data,
  });
}

/**
 * Supprime un support et ses écritures.
 *
 * Le journal part avec l'actif : laisser les transactions d'un actif supprimé
 * rendrait le rejeu impossible et casserait le portefeuille entier.
 */
export async function deleteSupport(
  userId: string,
  assetId: string
): Promise<void> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId, accountType: "AV" },
    select: { id: true },
  });
  if (!asset) throw new LifeInsuranceInputError("Support introuvable");

  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { userId, assetId } });
    // La cascade emporte LifeInsuranceSupport.
    await tx.asset.delete({ where: { id: assetId } });
  });
}

export type SupportRow = {
  assetId: string;
  supportId: string;
  lifeInsuranceId: string | null;
  name: string;
  /**
   * Classe d'actif du journal — actions, obligations, monétaire…
   *
   * Distincte de `kind`, qui dit la **nature du support** au sens du contrat
   * (fonds euro, unité de compte, produit structuré). Un contrat entièrement
   * en UC peut être intégralement obligataire : les deux répartitions
   * répondent à deux questions, et l'écran d'allocation les montre côte à côte.
   */
  assetClass: string | null;
  kind: string;
  isin: string | null;
  issuer: string | null;
  underlying: string | null;
  nominalEur: string | null;
  strikeLevel: string | null;
  couponRatePct: string | null;
  couponFrequency: string;
  couponBarrierPct: string | null;
  couponMemory: boolean;
  autocallBarrierPct: string | null;
  capitalProtectionPct: string | null;
  strikeDate: string | null;
  maturityDate: string | null;
  nextObservationDate: string | null;
  entryFeePct: string | null;
  managementFeePct: string | null;
  notes: string | null;
  /**
   * Valorisation **totale** de la position, quantité incluse.
   *
   * Distincte de `manualPrice`, qui est un prix unitaire : un fonds euro à
   * 1,02 € l'unité pour 25 000 parts vaut 25 500 €. Exposer le prix unitaire
   * sous le nom de « valorisation » invitait à y saisir le montant total, ce qui
   * multipliait la position par la quantité.
   */
  currentValueEur: string | null;
  /** Prix de revient au journal (CUMP × qté) — pour la quote-part de gains. */
  costBasisEur: string | null;
  unrealizedPnlEur: string | null;
  /** Quantité au journal — 1 pour un support créé ici. */
  quantity: string;
};

/**
 * Supports de l'utilisateur, avec leurs caractéristiques.
 *
 * La liste part des **positions** de l'enveloppe AV, pas des fiches de support.
 *
 * Interroger `LifeInsuranceSupport` d'abord rendait invisibles toutes les
 * positions dépourvues de fiche — celles reprises de l'ancienne saisie, qui
 * n'en ont jamais eu. Elles disparaissaient de l'écran sans même apparaître en
 * « sans contrat rattaché », donnant à croire que les données étaient perdues.
 * Une position AV existe : elle doit se voir, fiche ou pas.
 */
/**
 * Nature d'un support dépourvu de fiche.
 *
 * Une ligne reprise de l'ancienne saisie n'a pas de `LifeSupport` : sa nature
 * doit donc se relire ailleurs. On inverse la classification que l'application
 * pose elle-même à la création (`assetClassForKind`) : un fonds euro est rangé
 * en obligataire, tout le reste relève de l'UC. Ce n'est pas une devinette sur
 * le nom du support, c'est la lecture de ce que l'app a déjà décidé.
 *
 * L'enjeu n'est pas cosmétique : présenter un fonds en euros comme une unité
 * de compte annonce un capital à risque là où l'assureur le garantit.
 */
function kindFromAssetClass(assetClass: string | null | undefined): string {
  return assetClass === "OBLIGATIONS" ? "FONDS_EURO" : "UC";
}

export async function listSupports(userId: string): Promise<SupportRow[]> {
  // La valorisation vient de `getHoldings` : quantité × cours, repli manualPrice
  // → cotation → devise → FX. La recalculer ici reviendrait à répliquer cette
  // chaîne, et une première version l'avait faite fausse en prenant `manualPrice`
  // pour la valeur totale.
  const { getHoldings } = await import("../portfolio/service");

  const [assets, holdings] = await Promise.all([
    prisma.asset.findMany({
      where: { userId, accountType: "AV" },
      select: {
        id: true,
        name: true,
        isin: true,
        assetClass: true,
        lifeSupport: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    getHoldings(userId, "EUR"),
  ]);

  const byAsset = new Map(holdings.map((h) => [h.assetId, h]));

  return assets.map((a) => {
    const s = a.lifeSupport;
    const h = byAsset.get(a.id);
    return {
      assetId: a.id,
      supportId: s?.id ?? "",
      lifeInsuranceId: s?.lifeInsuranceId ?? null,
      name: a.name,
      assetClass: a.assetClass ?? null,
      kind: s?.kind ?? kindFromAssetClass(a.assetClass),
      isin: s?.isin ?? a.isin,
      issuer: s?.issuer ?? null,
      underlying: s?.underlying ?? null,
      nominalEur: s?.nominalEur?.toString() ?? null,
      strikeLevel: s?.strikeLevel?.toString() ?? null,
      couponRatePct: s?.couponRatePct?.toString() ?? null,
      couponFrequency: s?.couponFrequency ?? "ANNUAL",
      couponBarrierPct: s?.couponBarrierPct?.toString() ?? null,
      couponMemory: s?.couponMemory ?? false,
      autocallBarrierPct: s?.autocallBarrierPct?.toString() ?? null,
      capitalProtectionPct: s?.capitalProtectionPct?.toString() ?? null,
      strikeDate: s?.strikeDate?.toISOString() ?? null,
      maturityDate: s?.maturityDate?.toISOString() ?? null,
      nextObservationDate: s?.nextObservationDate?.toISOString() ?? null,
      entryFeePct: s?.entryFeePct?.toString() ?? null,
      managementFeePct: s?.managementFeePct?.toString() ?? null,
      notes: s?.notes ?? null,
      currentValueEur: h?.marketValueEur ?? null,
      /** Prix de revient journal — base de la quote-part de gains au rachat. */
      costBasisEur: h?.costBasisEur ?? null,
      unrealizedPnlEur: h?.unrealizedPnlEur ?? null,
      quantity: h?.quantity ?? "0",
    };
  });
}

/** Rattache un support déjà au journal à un contrat. */
export async function attachSupportToContract(
  userId: string,
  assetId: string,
  lifeInsuranceId: string | null
): Promise<void> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId, accountType: "AV" },
    select: { id: true, name: true, assetClass: true },
  });
  if (!asset) throw new LifeInsuranceInputError("Support introuvable");

  if (lifeInsuranceId) {
    const contract = await prisma.lifeInsurance.findFirst({
      where: { id: lifeInsuranceId, userId },
      select: { id: true },
    });
    if (!contract) throw new LifeInsuranceInputError("Contrat introuvable");
  }

  // Un support migré depuis l'ancienne table n'a pas encore de fiche : on la
  // crée à la volée plutôt que d'exiger une ressaisie. Sa nature se relit dans
  // la classe d'actif, seule trace laissée par la reprise — un fonds euro
  // figé en « unité de compte » annoncerait un capital à risque là où
  // l'assureur le garantit, et le rattachement est irréversible.
  await prisma.lifeInsuranceSupport.upsert({
    where: { assetId },
    create: {
      assetId,
      lifeInsuranceId,
      kind: kindFromAssetClass(asset.assetClass),
    },
    update: { lifeInsuranceId },
  });
}

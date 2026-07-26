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
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
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
  const currency = (contract.currency || "EUR").toUpperCase();
  const structured = isStructured(input.kind);

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
        manualPrice: amount,
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
        unitPrice: amount.toString(),
        fees: (dec(input.entryFeesEur) ?? new Prisma.Decimal(0)).toString(),
        currency,
        fxRateToEur: "1",
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
 * unitaire. On divise donc par la quantité du journal pour retrouver le prix
 * qu'attend `manualPrice` : écrire le total tel quel multiplierait la position
 * par sa quantité — un fonds euro de 25 000 parts passerait de 25 500 € à
 * 637 millions.
 *
 * Seul le prix bouge. La quantité et le prix de revient viennent du journal et
 * restent intacts, sinon la plus-value se dissoudrait à chaque mise à jour.
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
    select: { id: true },
  });
  if (!asset) throw new LifeInsuranceInputError("Support introuvable");

  const agg = await prisma.transaction.aggregate({
    where: { userId, assetId },
    _sum: { quantity: true },
  });
  const quantity = agg._sum.quantity ?? new Prisma.Decimal(0);

  // Position soldée : aucune quantité à valoriser, et diviser par zéro
  // écrirait un prix infini.
  if (quantity.lte(0)) {
    throw new LifeInsuranceInputError(
      "Support sans quantité — réévaluation impossible"
    );
  }

  await prisma.asset.update({
    where: { id: asset.id },
    data: { manualPrice: total.div(quantity) },
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
      // Sans fiche, la nature est inconnue : « UC » est le cas courant et le
      // moins engageant — pas de barrière, pas de garantie supposée.
      kind: s?.kind ?? "UC",
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
    select: { id: true, name: true },
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
  // crée à la volée plutôt que d'exiger une ressaisie.
  await prisma.lifeInsuranceSupport.upsert({
    where: { assetId },
    create: { assetId, lifeInsuranceId, kind: "UC" },
    update: { lifeInsuranceId },
  });
}

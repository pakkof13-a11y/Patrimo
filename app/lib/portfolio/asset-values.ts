/**
 * Valeur d'une position **par actif**, avant tout regroupement d'affichage.
 *
 * `getHoldings()` fusionne les lignes crypto de même ticker — un ETH en
 * portefeuille et un ETH staké chez Lido n'y forment qu'une seule ligne. C'est
 * volontaire pour le tableau Positions, mais inutilisable dès qu'on doit
 * attribuer une valeur à un actif précis : la ligne fusionnée ne porte qu'un
 * seul `assetId`, si bien qu'une recherche par actif ramènerait la valeur du
 * groupe entier pour l'un et rien du tout pour les autres.
 *
 * La résolution de prix reproduit celle de `getHoldings()` — quote, puis prix
 * manuel converti, puis coût de revient à défaut. Elle vit ici pour que les
 * deux vues ne puissent pas diverger.
 */

import Decimal from "decimal.js";
import { d, toFixed, zero } from "@/app/lib/money/decimal";
import { prisma } from "@/app/lib/prisma";
import { convertToEurSync, getEurRates } from "@/app/lib/market/fx";
import { loadLedgerForUser } from "./service";

export type AssetValue = {
  assetId: string;
  quantity: Decimal;
  priceEur: Decimal;
  marketValueEur: Decimal;
  costBasisEur: Decimal;
};

/**
 * Valeurs par actif pour les actifs demandés.
 *
 * Un actif sans position ouverte est absent de la map : il n'a pas une valeur
 * nulle, il n'a plus de position du tout, et les deux cas se traitent
 * différemment côté appelant.
 */
export async function getAssetValues(
  userId: string,
  assetIds: string[]
): Promise<Map<string, AssetValue>> {
  const out = new Map<string, AssetValue>();
  if (assetIds.length === 0) return out;

  const wanted = new Set(assetIds);
  const [ledger, assets, fx] = await Promise.all([
    loadLedgerForUser(userId),
    prisma.asset.findMany({
      where: { userId, id: { in: assetIds } },
      include: { priceQuote: true },
    }),
    getEurRates(),
  ]);

  const assetMap = new Map(assets.map((a) => [a.id, a]));

  // Un actif peut porter plusieurs positions (une par plateforme) : elles se
  // cumulent, contrairement aux tickers identiques d'actifs distincts.
  for (const pos of ledger.positions.values()) {
    if (!wanted.has(pos.assetId)) continue;
    if (pos.quantity.lte(0)) continue;
    const asset = assetMap.get(pos.assetId);
    if (!asset) continue;

    let priceEur = zero();
    if (asset.priceQuote) {
      priceEur = d(asset.priceQuote.priceEur.toString());
    } else if (asset.manualPrice) {
      priceEur = d(
        convertToEurSync(
          d(asset.manualPrice.toString()),
          asset.currency || "EUR",
          fx
        )
      );
    }
    // Sans cotation, le coût de revient tient lieu de valeur — une ligne à 0 €
    // laisserait croire à une perte totale là où le prix est simplement inconnu.
    if (priceEur.isZero() && pos.costBasisEur.gt(0) && pos.quantity.gt(0)) {
      priceEur = pos.costBasisEur.div(pos.quantity);
    }

    const prev = out.get(pos.assetId);
    const quantity = (prev?.quantity ?? zero()).plus(pos.quantity);
    const costBasisEur = (prev?.costBasisEur ?? zero()).plus(pos.costBasisEur);

    out.set(pos.assetId, {
      assetId: pos.assetId,
      quantity,
      priceEur,
      marketValueEur: quantity.times(priceEur),
      costBasisEur,
    });
  }

  return out;
}

/** Valeur en euros d'un actif, arrondie au centime. */
export function formatAssetValue(v: AssetValue): string {
  return toFixed(v.marketValueEur, 2);
}

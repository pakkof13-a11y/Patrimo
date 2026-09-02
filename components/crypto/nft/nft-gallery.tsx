"use client";

import { useState } from "react";
import { Eye, EyeOff, ImageOff } from "lucide-react";
import { cn, formatCurrency } from "@/app/lib/utils";
import { d } from "@/app/lib/money/decimal";
import {
  getNftAcquisitionCostDisplay,
  getNftStatusBadges,
  getNftValuationDisplay,
  type ClientNftHolding,
} from "@/app/lib/crypto/nft-ui-rules";
import { NftBadgeList } from "./nft-badges";

/**
 * Vue Galerie — une carte par NFT. Toute la carte est un bouton (ouverture du
 * détail au clic/Entrée) ; le bascule masquer/afficher reste un bouton
 * toujours visible, jamais conditionné au survol (règle d'accessibilité).
 */
export function NftGallery({
  holdings,
  onOpenDetail,
  onToggleHidden,
}: {
  holdings: ClientNftHolding[];
  onOpenDetail: (assetId: string) => void;
  onToggleHidden: (assetId: string, hidden: boolean) => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      data-testid="nft-gallery"
    >
      {holdings.map((h) => (
        <NftCard key={h.assetId} h={h} onOpenDetail={onOpenDetail} onToggleHidden={onToggleHidden} />
      ))}
    </div>
  );
}

function NftCard({
  h,
  onOpenDetail,
  onToggleHidden,
}: {
  h: ClientNftHolding;
  onOpenDetail: (assetId: string) => void;
  onToggleHidden: (assetId: string, hidden: boolean) => void;
}) {
  const [mediaBroken, setMediaBroken] = useState(false);
  const badges = getNftStatusBadges(h);
  const valuation = getNftValuationDisplay(h);
  const acquisitionDisplay = getNftAcquisitionCostDisplay(h);
  const showMedia = h.imageUrl && !mediaBroken;

  const gainLoss =
    valuation.isValuable && acquisitionDisplay != null
      ? d(h.retainedValueEur).minus(d(acquisitionDisplay))
      : null;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] transition",
        "focus-within:shadow-[var(--focus-ring)] hover:border-[var(--border-strong)]",
        h.isSpam && "opacity-60"
      )}
      data-testid="nft-card"
      data-asset-id={h.assetId}
    >
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => onOpenDetail(h.assetId)}
        aria-label={`Voir le détail de ${h.name}`}
        data-testid="nft-card-open"
      >
        <div className="aspect-square w-full bg-[var(--muted)]/40">
          {showMedia ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={h.imageUrl!}
              alt={h.name}
              className="h-full w-full object-cover"
              onError={() => setMediaBroken(true)}
            />
          ) : (
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--muted-foreground)]"
              data-testid="nft-card-media-placeholder"
            >
              <ImageOff className="h-6 w-6 opacity-50" aria-hidden />
              <span className="text-[10px]">{mediaBroken ? "Média illisible" : "Sans média"}</span>
            </div>
          )}
        </div>
        <div className="p-2">
          <p className="truncate text-xs font-medium" title={h.name}>
            {h.name}
          </p>
          <p className="text-meta truncate" title={h.collectionName ?? undefined}>
            {h.collectionName || "Sans collection"}
          </p>

          <div className="mt-1.5 space-y-0.5">
            <ValueLine
              label="Valeur retenue"
              displayText={valuation.retainedDisplayText}
              strong
              testId="nft-card-retained-value"
            />
            {h.collectionFloorPriceEur && (
              <ValueLine label="Floor collection" displayText={h.collectionFloorPriceEur} muted />
            )}
            {acquisitionDisplay != null && (
              <ValueLine label="Acquisition" displayText={acquisitionDisplay} muted />
            )}
            {gainLoss && (
              <p
                className={cn(
                  "text-[10px] tabular-nums",
                  gainLoss.gte(0) ? "text-[var(--success)]" : "text-[var(--danger)]"
                )}
              >
                {gainLoss.gte(0) ? "+" : ""}
                {formatCurrency(gainLoss.toFixed(2), "EUR")} latent
              </p>
            )}
          </div>

          <NftBadgeList badges={badges} className="mt-1.5" />
        </div>
      </button>

      <button
        type="button"
        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--card)]/90 text-[var(--muted-foreground)] shadow-sm transition hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        onClick={() => onToggleHidden(h.assetId, !h.isHidden)}
        aria-label={h.isHidden ? `Réafficher ${h.name}` : `Masquer ${h.name}`}
        data-testid="nft-card-toggle-hidden"
      >
        {h.isHidden ? <Eye className="h-3.5 w-3.5" aria-hidden /> : <EyeOff className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  );
}

function ValueLine({
  label,
  displayText,
  strong,
  muted,
  testId,
}: {
  label: string;
  displayText: string | null;
  strong?: boolean;
  muted?: boolean;
  testId?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-baseline justify-between gap-1 tabular-nums",
        strong ? "text-xs font-semibold" : "text-[10px]",
        muted && "text-[var(--muted-foreground)]"
      )}
      data-testid={testId}
    >
      <span className="truncate font-normal text-[var(--muted-foreground)]">{label}</span>
      {displayText != null ? (
        <span>{formatCurrency(displayText, "EUR")}</span>
      ) : (
        <span className="italic text-[var(--warning)]">Inconnue</span>
      )}
    </p>
  );
}

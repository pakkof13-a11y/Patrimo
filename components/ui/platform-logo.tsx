"use client";

import { useMemo, useState } from "react";
import { cn } from "@/app/lib/utils";
import {
  assetLogoSources,
  platformLogoSources,
} from "@/app/lib/logos/logodev";

/**
 * Rendu d'un logo, actif comme plateforme.
 *
 * Un logo n'a pas de source unique : logo.dev répond selon un domaine, un
 * ticker, un ISIN, un symbole crypto ou un nom, et l'identifiant utilisable
 * dépend de ce que l'on affiche. Le composant reçoit donc une liste de sources
 * ordonnée et descend au maillon suivant à chaque échec, jusqu'au monogramme
 * local — qui, lui, ne dépend d'aucun réseau.
 */

function Monogram({
  name,
  size,
  className,
}: {
  name: string;
  size: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");

  return (
    <span
      data-logo
      data-logo-fallback="monogram"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-teal-100 text-[10px] font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-200",
        className
      )}
      style={{ width: size, height: size }}
      title={name}
    >
      {initials || "?"}
    </span>
  );
}

function LogoImage({
  sources,
  name,
  size,
  className,
}: {
  sources: string[];
  name: string;
  size: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  // Repartir du début quand les sources changent : sans cette clé, une ligne
  // recyclée par le tableau garderait l'échec de la précédente.
  const key = sources[0] ?? name;

  if (index >= sources.length) {
    return <Monogram name={name} size={size} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={key}
      data-logo
      src={sources[index]}
      alt={name}
      width={size}
      height={size}
      className={cn(
        "shrink-0 rounded-md object-contain bg-white dark:bg-slate-900",
        className
      )}
      style={{ width: size, height: size }}
      onError={() => setIndex((i) => i + 1)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * Logo d'une plateforme : courtier, banque, exchange, blockchain.
 * Résolution domaine connu → nom → monogramme.
 */
export function PlatformLogo({
  src,
  name,
  domain,
  size = 20,
  className,
}: {
  src?: string | null;
  name: string;
  domain?: string | null;
  size?: number;
  className?: string;
}) {
  const sources = useMemo(
    () => platformLogoSources({ logoUrl: src, name, domain, size }),
    [src, name, domain, size]
  );
  if (sources.length === 0) {
    return <Monogram name={name} size={size} className={className} />;
  }
  return (
    <LogoImage sources={sources} name={name} size={size} className={className} />
  );
}

/**
 * Logo d'un actif : action, ETF, crypto.
 * Résolution symbole crypto ou ticker/ISIN → nom → monogramme.
 */
export function AssetLogo({
  src,
  name,
  ticker,
  isin,
  assetClass,
  size = 20,
  className,
}: {
  src?: string | null;
  name: string;
  ticker?: string | null;
  isin?: string | null;
  assetClass?: string | null;
  size?: number;
  className?: string;
}) {
  const sources = useMemo(
    () => assetLogoSources({ logoUrl: src, name, ticker, isin, assetClass, size }),
    [src, name, ticker, isin, assetClass, size]
  );
  if (sources.length === 0) {
    return <Monogram name={name} size={size} className={className} />;
  }
  return (
    <LogoImage sources={sources} name={name} size={size} className={className} />
  );
}

/**
 * Image déjà résolue (visuel de NFT, illustration importée) : aucune
 * déduction, seulement le repli monogramme si elle ne charge pas.
 */
export function ImageLogo({
  src,
  name,
  size = 20,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const sources = useMemo(() => (src ? [src] : []), [src]);
  if (sources.length === 0) {
    return <Monogram name={name} size={size} className={className} />;
  }
  return (
    <LogoImage sources={sources} name={name} size={size} className={className} />
  );
}

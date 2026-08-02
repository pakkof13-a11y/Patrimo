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

/**
 * Forme du logo.
 *
 * Rond par défaut : c'est la forme d'un jeton, d'une pastille de marque, et
 * elle donne une colonne d'actifs bien plus calme qu'une file de carrés aux
 * coins arrondis. Le carré reste pour les visuels qui *sont* l'image et non
 * une marque — l'œuvre d'un NFT, qu'un cercle amputerait.
 */
type LogoShape = "circle" | "square";

function shapeClass(shape: LogoShape): string {
  return shape === "circle" ? "rounded-full" : "rounded-md";
}

function Monogram({
  name,
  size,
  shape = "circle",
  className,
}: {
  name: string;
  size: number;
  shape?: LogoShape;
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
        "inline-flex shrink-0 items-center justify-center bg-teal-100 text-[10px] font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-200",
        shapeClass(shape),
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
  shape = "circle",
  className,
}: {
  sources: string[];
  name: string;
  size: number;
  shape?: LogoShape;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  // Une ligne de tableau est recyclée d'un actif à l'autre sans être démontée :
  // sans cette remise à zéro, le rang atteint par l'actif précédent — souvent
  // le monogramme — s'appliquerait au suivant, qui n'a rien tenté.
  const [seenFirst, setSeenFirst] = useState(sources[0]);
  if (sources[0] !== seenFirst) {
    setSeenFirst(sources[0]);
    setIndex(0);
  }

  if (index >= sources.length) {
    return (
      <Monogram name={name} size={size} shape={shape} className={className} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-logo
      src={sources[index]}
      alt={name}
      width={size}
      height={size}
      className={cn(
        "shrink-0 object-contain bg-white dark:bg-slate-900",
        shapeClass(shape),
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
 *
 * Carrée, à la différence des logos : ici l'image *est* l'objet et non la
 * marque qui le désigne — un cercle rognerait l'œuvre d'un NFT au lieu de la
 * cadrer. `shape` reste ouvert pour les appelants qui montrent bien une
 * marque par ce chemin.
 */
export function ImageLogo({
  src,
  name,
  size = 20,
  shape = "square",
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  shape?: LogoShape;
  className?: string;
}) {
  const sources = useMemo(() => (src ? [src] : []), [src]);
  if (sources.length === 0) {
    return (
      <Monogram name={name} size={size} shape={shape} className={className} />
    );
  }
  return (
    <LogoImage
      sources={sources}
      name={name}
      size={size}
      shape={shape}
      className={className}
    />
  );
}

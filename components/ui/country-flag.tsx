"use client";

import { useState } from "react";
import {
  countryCodeLabel,
  flagIconSvgUrl,
  toIsoAlpha2,
} from "@/app/lib/countries";
import { cn } from "@/app/lib/utils";

/**
 * Country flag from flag-icon-css (MIT) via CDN SVG 4x3.
 * Keeps ISO alpha-2 display code next to the icon when showCode is true.
 */
export function CountryFlag({
  code,
  showCode = true,
  className,
  imgClassName,
}: {
  /** ISO-3166-1 alpha-2 or macro label (DE, UK, EZ, US…) */
  code: string;
  showCode?: boolean;
  className?: string;
  imgClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const iso = toIsoAlpha2(code);
  const label = countryCodeLabel(code);
  const src = flagIconSvgUrl(code);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-slate-700",
        className
      )}
      title={`${label} (${iso.toUpperCase()})`}
    >
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={16}
          height={12}
          loading="lazy"
          decoding="async"
          className={cn(
            "h-3 w-4 shrink-0 rounded-[1px] object-cover shadow-sm ring-1 ring-black/10 dark:ring-white/15",
            imgClassName
          )}
          onError={() => setFailed(true)}
          data-iso={iso}
        />
      ) : (
        <span
          className="inline-block h-3 w-4 shrink-0 rounded-[1px] bg-slate-400/50 dark:bg-slate-500/50"
          aria-hidden
        />
      )}
      {showCode && <span>{label}</span>}
    </span>
  );
}

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
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground)] shadow-sm",
        "dark:bg-[var(--muted)]/60",
        className
      )}
      title={`${label} (${iso.toUpperCase()})`}
    >
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={18}
          height={14}
          loading="lazy"
          decoding="async"
          className={cn(
            "h-3.5 w-[18px] shrink-0 rounded-[2px] object-cover shadow-sm ring-1 ring-black/12 dark:ring-white/20",
            imgClassName
          )}
          onError={() => setFailed(true)}
          data-iso={iso}
        />
      ) : (
        <span
          className="inline-block h-3.5 w-[18px] shrink-0 rounded-[2px] bg-slate-400/50 dark:bg-slate-500/50"
          aria-hidden
        />
      )}
      {showCode && (
        <span className="leading-none text-[var(--muted-foreground)]">
          {label}
        </span>
      )}
    </span>
  );
}

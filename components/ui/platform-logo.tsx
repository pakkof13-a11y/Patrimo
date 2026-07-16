"use client";

import { useState } from "react";
import { cn } from "@/app/lib/utils";
import { logoByName } from "@/app/lib/logos/logodev";

/**
 * Displays a company/platform/asset logo.
 * Prefers `src` (often a Logo.dev URL); falls back to Logo.dev by name, then monogram initials.
 */
export function PlatformLogo({
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
  const [stage, setStage] = useState<"src" | "name" | "mono">(
    src ? "src" : name ? "name" : "mono"
  );

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");

  if (stage === "mono" || (!src && !name)) {
    return (
      <span
        data-logo
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

  const imageSrc =
    stage === "src" && src
      ? src
      : logoByName(name || "?", {
          size: Math.max(size * 2, 64),
          format: "png",
          retina: true,
          theme: "auto",
          fallback: "monogram",
        });

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-logo
      src={imageSrc}
      alt={name}
      width={size}
      height={size}
      className={cn(
        "shrink-0 rounded-md object-contain bg-white dark:bg-slate-900",
        className
      )}
      style={{ width: size, height: size }}
      onError={() => {
        if (stage === "src" && name) setStage("name");
        else setStage("mono");
      }}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

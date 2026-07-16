"use client";

import { HelpCircle } from "lucide-react";
import { cn } from "@/app/lib/utils";

const TIPS: Record<string, string> = {
  CUMP: "Coût unitaire moyen pondéré de vos achats (frais d’achat inclus).",
  "P&L latent":
    "Gain ou perte théorique sur les positions encore détenues (cours − CUMP).",
  "P&L réalisé":
    "Gain ou perte enregistré lors d’une vente ou d’une opération clôturée.",
  PRU: "Prix de revient unitaire — équivalent au CUMP sur cette application.",
};

/**
 * Infobulle discrète pour acronymes financiers (hover + focus clavier).
 */
export function FinanceTip({
  term,
  className,
}: {
  term: keyof typeof TIPS | string;
  className?: string;
}) {
  const text = TIPS[term] ?? term;
  return (
    <span
      className={cn(
        "group relative inline-flex align-middle text-slate-400",
        className
      )}
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
    >
      <HelpCircle className="h-3 w-3 opacity-60 transition group-hover:opacity-100 group-focus:opacity-100" />
      <span
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-48 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-left text-[10px] font-normal leading-snug text-slate-600 opacity-0 shadow-lg transition",
          "group-hover:opacity-100 group-focus:opacity-100 dark:text-slate-300",
          "motion-reduce:transition-none"
        )}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}

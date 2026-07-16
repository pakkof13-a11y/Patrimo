"use client";

import { Suspense } from "react";
import { PortfolioApp } from "@/components/app/portfolio-app";

/**
 * Shell stable : ne se re-monte PAS à chaque changement d'URL
 * (/positions → /dashboard, etc.). Seul ce layout reste monté,
 * ce qui évite le clignotement (démontage complet de l'UI).
 */
export default function PortfolioSlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense fallback={<div className="p-6 text-sm text-slate-500">Chargement…</div>}>
        <PortfolioApp />
      </Suspense>
      <div className="hidden" aria-hidden>
        {children}
      </div>
    </>
  );
}

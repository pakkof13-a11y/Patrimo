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
      <Suspense
        fallback={
          <div
            className="min-h-screen p-6"
            aria-busy="true"
            data-testid="slug-suspense-fallback"
          >
            <div className="app-shell space-y-4">
              <div className="h-10 skeleton-block rounded-lg" />
              <div className="grid gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 skeleton-block rounded-xl" />
                ))}
              </div>
              <div className="h-48 skeleton-block rounded-xl" />
            </div>
          </div>
        }
      >
        <PortfolioApp />
      </Suspense>
      <div className="hidden" aria-hidden>
        {children}
      </div>
    </>
  );
}

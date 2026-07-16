"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { cn } from "@/app/lib/utils";

const STORAGE_KEY = "patrimo.securityBanner.dismissed";

/**
 * Avertissement mode single-user (auth désactivée) — non sûr en exposition réseau.
 */
export function SecurityBanner({ className }: { className?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "border-b border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-50",
        className
      )}
      data-testid="security-banner"
      role="status"
    >
      <div className="app-shell flex items-start gap-2 px-3 py-2 sm:px-5 lg:px-6">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <p className="flex-1 text-[11px] leading-snug sm:text-xs">
          <strong>Mode personnel local</strong> — authentification multi-utilisateur
          désactivée. Ne pas exposer cette app sur Internet sans rebrancher
          NextAuth. Toute personne sur le réseau local partage le même compte.
        </p>
        <button
          type="button"
          className="rounded p-1 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900"
          aria-label="Masquer l'avertissement"
          data-testid="security-banner-dismiss"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, "1");
            } catch {
              /* ignore */
            }
            setVisible(false);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

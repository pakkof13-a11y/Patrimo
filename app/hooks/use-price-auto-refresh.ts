"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, reloadHoldings } from "@/app/lib/api-client";
import { PRICE_AUTO_REFRESH_MS } from "@/app/lib/constants";
import { useNotifications } from "@/app/lib/notifications/context";

/**
 * Price refresh mutation + auto interval with backoff after consecutive failures.
 * After 3 silent failures → pause auto-refresh 60s and surface one toast.
 */
export function usePriceAutoRefresh(baseCurrencyRef: { current: string }) {
  const qc = useQueryClient();
  const { pushFromTriggerFills } = useNotifications();
  const refreshInFlightRef = useRef(false);
  const failStreakRef = useRef(0);
  const pausedUntilRef = useRef(0);
  const [lastPriceSync, setLastPriceSync] = useState<Date | null>(null);
  const lastPriceSyncRef = useRef<number>(0);
  const [priceSyncPulse, setPriceSyncPulse] = useState(false);

  const refreshMutation = useMutation({
    mutationFn: async (opts?: { silent?: boolean }) => {
      const data = await fetchJson<{
        results: Array<{ name: string; ok: boolean }>;
        successCount: number;
        failureCount: number;
        triggerFills?: Array<{
          name: string;
          fills: Array<{ kind: string; quantity: string; unitPrice: string }>;
          error?: string;
        }>;
      }>("/api/prices/refresh", { method: "POST" });
      return { ...data, silent: Boolean(opts?.silent) };
    },
    onSuccess: async (data) => {
      failStreakRef.current = 0;
      pausedUntilRef.current = 0;
      try {
        await reloadHoldings(qc, baseCurrencyRef.current);
      } catch (e) {
        failStreakRef.current += 1;
        if (failStreakRef.current >= 3) {
          pausedUntilRef.current = Date.now() + 60_000;
        }
        if (!data.silent) {
          toast.error(
            e instanceof Error ? e.message : "Échec rechargement portefeuille"
          );
        } else if (failStreakRef.current === 3) {
          toast.error(
            "Portefeuille inaccessible — auto-refresh en pause 60s (essayez npm run db:regen)"
          );
        }
        return;
      }
      // Silent price tick : ne pas invalider transactions (flash table).
      // History : refresh soft uniquement si l'utilisateur regarde le dashboard.
      if (!data.silent) {
        void qc.invalidateQueries({ queryKey: ["portfolio-history"] });
        void qc.invalidateQueries({ queryKey: ["transactions"] });
      } else {
        void qc.invalidateQueries({
          queryKey: ["portfolio-history"],
          refetchType: "none",
        });
      }
      const now = new Date();
      setLastPriceSync(now);
      lastPriceSyncRef.current = now.getTime();
      setPriceSyncPulse(true);
      window.setTimeout(() => setPriceSyncPulse(false), 800);

      const fills = data.triggerFills ?? [];
      if (fills.length) {
        // System notifications (bell) for TP / SL hits
        pushFromTriggerFills(fills);
        const parts = fills.flatMap((r) =>
          r.fills.map(
            (f) =>
              `${r.name}: ${f.kind} × ${Number(f.quantity).toLocaleString("fr-FR", {
                maximumFractionDigits: 6,
              })} @ ${f.unitPrice}`
          )
        );
        toast.success(`Ordres auto exécutés · ${parts.slice(0, 4).join(" · ")}`, {
          description: parts.length > 4 ? `+${parts.length - 4} autre(s)` : undefined,
          duration: 8000,
        });
      }

      if (!data.silent) {
        toast.success(`Prix : ${data.successCount} OK · ${data.failureCount} échec(s)`);
      }
    },
    onError: (e: Error, vars) => {
      failStreakRef.current += 1;
      if (failStreakRef.current >= 3) {
        pausedUntilRef.current = Date.now() + 60_000;
      }
      if (!vars?.silent) {
        toast.error(e.message);
      } else if (failStreakRef.current === 3) {
        toast.error(
          `${e.message} — auto-refresh en pause 60s (souvent Prisma : npm run db:regen)`
        );
      }
    },
    onSettled: () => {
      refreshInFlightRef.current = false;
    },
  });

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      // Pause totale si onglet caché (économie + moins de charge API)
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (refreshInFlightRef.current) return;
      if (Date.now() < pausedUntilRef.current) return;
      refreshInFlightRef.current = true;
      refreshMutation.mutate({ silent: true });
    };

    const id = window.setInterval(tick, PRICE_AUTO_REFRESH_MS);

    // Au retour sur l'onglet : un refresh silencieux si stale (> interval)
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (cancelled) return;
      if (Date.now() - lastPriceSyncRef.current < PRICE_AUTO_REFRESH_MS) return;
      tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    refreshMutation,
    lastPriceSync,
    priceSyncPulse,
  };
}

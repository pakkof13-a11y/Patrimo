"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, reloadHoldings } from "@/app/lib/api-client";
import {
  PRICE_AUTO_REFRESH_MS,
  PRICE_REFRESH_BACKOFF_BASE_MS,
  PRICE_REFRESH_BACKOFF_MAX_MS,
} from "@/app/lib/constants";
import { useNotifications } from "@/app/lib/notifications/context";

const LEADER_KEY = "patrimo.priceRefresh.leader.v1";
const LEADER_TTL_MS = 25_000;
const BC_NAME = "patrimo-price-refresh";

type LeaderPayload = { id: string; exp: number };

function readLeader(): LeaderPayload | null {
  try {
    const raw = localStorage.getItem(LEADER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LeaderPayload;
  } catch {
    return null;
  }
}

function writeLeader(id: string, exp: number): void {
  try {
    localStorage.setItem(LEADER_KEY, JSON.stringify({ id, exp }));
  } catch {
    /* private mode */
  }
}

/**
 * Price refresh + auto interval (onglet leader uniquement).
 * @param enabled — false sur les vues sans besoin de cours live (fiscal, etc.)
 */
export function usePriceAutoRefresh(
  baseCurrencyRef: { current: string },
  opts?: { enabled?: boolean }
) {
  const enabled = opts?.enabled !== false;
  const qc = useQueryClient();
  const { pushFromTriggerFills } = useNotifications();
  const refreshInFlightRef = useRef(false);
  const failStreakRef = useRef(0);
  const pausedUntilRef = useRef(0);
  /** Stable tab id — lazy useState (impure init OK, not during render body). */
  const [tabId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `t-${Date.now().toString(36)}`
  );
  // tabId est stable (lazy init, jamais réassigné) — pas besoin de resync le ref au render
  const tabIdRef = useRef(tabId);
  const [lastPriceSync, setLastPriceSync] = useState<Date | null>(null);
  const lastPriceSyncRef = useRef<number>(0);
  const [priceSyncPulse, setPriceSyncPulse] = useState(false);

  const refreshMutation = useMutation({
    mutationFn: async (vars?: { silent?: boolean; fromLeader?: boolean }) => {
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
      return {
        ...data,
        silent: Boolean(vars?.silent),
        fromLeader: Boolean(vars?.fromLeader),
      };
    },
    onSuccess: async (data) => {
      failStreakRef.current = 0;
      pausedUntilRef.current = 0;
      try {
        await reloadHoldings(qc, baseCurrencyRef.current);
      } catch (e) {
        failStreakRef.current += 1;
        scheduleBackoff();
        if (!data.silent) {
          toast.error(
            e instanceof Error ? e.message : "Échec rechargement portefeuille"
          );
        } else if (failStreakRef.current === 3) {
          toast.error(
            "Portefeuille inaccessible — auto-refresh en pause (essayez npm run db:regen)"
          );
        }
        return;
      }

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

      // Notifier les autres onglets : invalider holdings sans re-fetch providers
      if (data.fromLeader) {
        try {
          const bc = new BroadcastChannel(BC_NAME);
          bc.postMessage({
            type: "prices-refreshed",
            at: now.getTime(),
          });
          bc.close();
        } catch {
          /* BroadcastChannel indisponible */
        }
      }

      const fills = data.triggerFills ?? [];
      if (fills.length) {
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
          description:
            parts.length > 4 ? `+${parts.length - 4} autre(s)` : undefined,
          duration: 8000,
        });
      }

      if (!data.silent) {
        toast.success(
          `Prix : ${data.successCount} OK · ${data.failureCount} échec(s)`
        );
      }
    },
    onError: (e: Error, vars) => {
      failStreakRef.current += 1;
      scheduleBackoff();
      if (!vars?.silent) {
        toast.error(e.message);
      } else if (failStreakRef.current === 3) {
        toast.error(
          `${e.message} — auto-refresh en pause (souvent Prisma : npm run db:regen)`
        );
      }
    },
    onSettled: () => {
      refreshInFlightRef.current = false;
    },
  });

  function scheduleBackoff() {
    const exp = Math.min(4, Math.max(0, failStreakRef.current - 1));
    const wait = Math.min(
      PRICE_REFRESH_BACKOFF_MAX_MS,
      PRICE_REFRESH_BACKOFF_BASE_MS * Math.pow(2, exp)
    );
    pausedUntilRef.current = Date.now() + wait;
  }

  /** Devient / reste leader si lock libre ou expiré. */
  function tryClaimLeader(): boolean {
    const now = Date.now();
    const cur = readLeader();
    if (cur && cur.id !== tabIdRef.current && cur.exp > now) {
      return false;
    }
    writeLeader(tabIdRef.current, now + LEADER_TTL_MS);
    return true;
  }

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let bc: BroadcastChannel | null = null;

    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type?: string; at?: number } | null;
        if (!msg || msg.type !== "prices-refreshed") return;
        // Follower : rafraîchir holdings depuis le cache serveur / re-GET, pas providers
        void reloadHoldings(qc, baseCurrencyRef.current).then(() => {
          if (typeof msg.at === "number") {
            lastPriceSyncRef.current = msg.at;
            setLastPriceSync(new Date(msg.at));
          }
        });
      };
    } catch {
      bc = null;
    }

    const tick = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (!tryClaimLeader()) return;
      if (refreshInFlightRef.current) return;
      if (Date.now() < pausedUntilRef.current) return;
      refreshInFlightRef.current = true;
      refreshMutation.mutate({ silent: true, fromLeader: true });
    };

    // Heartbeat leader (garde le lock)
    const heartbeat = window.setInterval(() => {
      if (cancelled) return;
      const cur = readLeader();
      if (cur?.id === tabIdRef.current) {
        writeLeader(tabIdRef.current, Date.now() + LEADER_TTL_MS);
      }
    }, 8_000);

    const id = window.setInterval(tick, PRICE_AUTO_REFRESH_MS);

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (cancelled) return;
      if (Date.now() - lastPriceSyncRef.current < PRICE_AUTO_REFRESH_MS * 0.5) {
        return;
      }
      tick();
    };
    document.addEventListener("visibilitychange", onVis);

    const thisTabId = tabId;
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVis);
      try {
        bc?.close();
      } catch {
        /* ignore */
      }
      // Libérer le leadership si on est leader
      try {
        const cur = readLeader();
        if (cur?.id === thisTabId) {
          localStorage.removeItem(LEADER_KEY);
        }
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    refreshMutation,
    lastPriceSync,
    priceSyncPulse,
  };
}

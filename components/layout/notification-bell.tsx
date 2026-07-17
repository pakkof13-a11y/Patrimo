"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Trash2, Target, ShieldAlert } from "lucide-react";
import { useNotifications } from "@/app/lib/notifications/context";
import type { AppNotification } from "@/app/lib/notifications/types";
import { cn } from "@/app/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: fr });
  } catch {
    return "—";
  }
}

function clockTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function NotificationRow({
  n,
  onRead,
}: {
  n: AppNotification;
  onRead: (id: string) => void;
}) {
  const Icon = n.type === "SL_HIT" ? ShieldAlert : Target;
  const accent =
    n.type === "SL_HIT"
      ? "text-red-500 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <button
      type="button"
      onClick={() => onRead(n.id)}
      className={cn(
        "flex w-full gap-2.5 border-b border-[var(--border)] px-3 py-2.5 text-left transition last:border-b-0",
        n.isRead
          ? "bg-transparent hover:bg-[var(--muted)]/40"
          : "bg-teal-50/60 hover:bg-teal-50 dark:bg-teal-950/30 dark:hover:bg-teal-950/50"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--muted)]",
          accent
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "text-xs font-semibold leading-snug",
              n.isRead
                ? "text-slate-600 dark:text-slate-300"
                : "text-slate-900 dark:text-slate-50"
            )}
          >
            {n.title}
          </span>
          {!n.isRead && (
            <span
              className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
              title="Non lu"
            />
          )}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-600 dark:text-slate-400">
          {n.message}
        </span>
        <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">
          {clockTime(n.timestamp)} · {relativeTime(n.timestamp)}
        </span>
      </span>
    </button>
  );
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAll,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef} data-testid="notification-bell">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition",
          "hover:bg-[var(--muted)] hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40",
          open && "bg-[var(--muted)] text-teal-800 dark:text-teal-200"
        )}
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} non lues)`
            : "Notifications"
        }
        aria-expanded={open}
        data-testid="notification-bell-btn"
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-[var(--card)]" />
          </span>
        )}
      </button>

      <div
        className={cn(
          "absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[min(22rem,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl transition duration-200",
          open
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none -translate-y-1 scale-95 opacity-0"
        )}
        role="dialog"
        aria-label="Liste des notifications"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <div>
            <div className="text-sm font-semibold">Notifications</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {unreadCount > 0
                ? `${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`
                : "Aucune non lue"}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40 dark:text-teal-300 dark:hover:bg-teal-950/50"
              title="Tout marquer comme lu"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tout lu
            </button>
            <button
              type="button"
              onClick={() => {
                if (notifications.length && confirm("Vider tout l'historique des notifications ?")) {
                  clearAll();
                }
              }}
              disabled={notifications.length === 0}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/40"
              title="Vider l'historique"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Vider
            </button>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Aucune notification pour le moment.
              <div className="mt-1 text-[10px] opacity-80">
                Les alertes SL / TP apparaissent ici automatiquement.
              </div>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationRow key={n.id} n={n} onRead={markAsRead} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

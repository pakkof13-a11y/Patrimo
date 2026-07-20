"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  notificationFromTriggerFill,
  type AppNotification,
  type TriggerFillEvent,
} from "./types";

const STORAGE_KEY = "patrimo.notifications.v1";
const MAX_ITEMS = 80;

type NotificationsContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  pushFromTriggerFills: (fills: TriggerFillEvent[]) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const emptySubscribe = () => () => undefined;

/** true uniquement après hydratation client (SSR = false). */
function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function loadStored(): AppNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n) => n && typeof n.id === "string" && typeof n.message === "string")
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function persist(list: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {
    /* quota */
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const isClient = useIsClient();
  /** Toujours [] au SSR / premier paint pour coller à l’HTML serveur. */
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const seededRef = useRef(false);

  // Seed localStorage hors effect (évite react-hooks/set-state-in-effect).
  // Un seul passage client après hydratation.
  if (isClient && !seededRef.current) {
    seededRef.current = true;
    const stored = loadStored();
    if (stored.length > 0) {
      setNotifications(stored);
    }
  }

  const pushFromTriggerFills = useCallback((fills: TriggerFillEvent[]) => {
    const incoming: AppNotification[] = [];
    for (const row of fills) {
      for (const f of row.fills ?? []) {
        const n = notificationFromTriggerFill(row.name, f);
        if (n) incoming.push(n);
      }
    }
    if (!incoming.length) return;
    setNotifications((prev) => {
      // Newest first
      const next = [...incoming, ...prev].slice(0, MAX_ITEMS);
      persist(next);
      return next;
    });
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      persist(next);
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, isRead: true }));
      persist(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    persist([]);
    setNotifications([]);
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      pushFromTriggerFills,
      markAsRead,
      markAllAsRead,
      clearAll,
    }),
    [
      notifications,
      unreadCount,
      pushFromTriggerFills,
      markAsRead,
      markAllAsRead,
      clearAll,
    ]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return ctx;
}

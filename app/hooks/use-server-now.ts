"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Horloge synchronisée sur le serveur.
 *
 * Le navigateur ne peut pas interroger un serveur NTP directement, mais le
 * serveur d'API (hébergement cloud) est lui déjà synchronisé NTP. On corrige
 * donc l'horloge locale à partir de l'`generatedAt` renvoyé par l'API : l'écart
 * entre l'heure serveur annoncée et l'heure locale au moment de la réception
 * donne un offset appliqué à toutes les comparaisons temporelles.
 *
 * Le temps renvoyé « tique » (par défaut toutes les 30 s) pour que les statuts
 * dépendant de l'heure (ex. « Publié » quand l'horaire est passé) basculent en
 * direct tant que le composant est monté.
 *
 * Implémentation : l'horloge est une **source externe mutable**, donc exposée
 * via `useSyncExternalStore`. Les effets se contentent de pousser vers ce store
 * (usage prévu d'un effet : « mettre à jour un système externe »), ce qui évite
 * à la fois le `setState` synchrone dans un effet (rendus en cascade) et la
 * lecture impure de `Date.now()` pendant le rendu.
 */
type ClockStore = ReturnType<typeof createClockStore>;

function createClockStore(initialTickMs: number) {
  let offsetMs = 0;
  let tickMs = initialTickMs;
  let snapshot = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  /** Recalcule l'instantané ; ne notifie que s'il a réellement bougé. */
  const refresh = () => {
    const next = Date.now() + offsetMs;
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const start = () => {
    if (timer === null) timer = setInterval(refresh, tickMs);
  };
  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        // Dernier abonné parti : on arrête l'intervalle (pas de timer orphelin).
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
    /** SSR : valeur figée, l'offset est appliqué après hydratation. */
    getServerSnapshot: () => snapshot,
    syncServerTime(serverMs: number) {
      offsetMs = serverMs - Date.now();
      refresh();
    },
    setTickMs(next: number) {
      if (next === tickMs) return;
      tickMs = next;
      if (timer !== null) {
        stop();
        start();
      }
    },
  };
}

export function useServerNow(
  serverIso?: string | null,
  tickMs = 30_000
): number {
  const [store] = useState<ClockStore>(() => createClockStore(tickMs));

  useEffect(() => {
    store.setTickMs(tickMs);
  }, [store, tickMs]);

  useEffect(() => {
    if (!serverIso) return;
    const server = Date.parse(serverIso);
    if (Number.isFinite(server)) store.syncServerTime(server);
  }, [store, serverIso]);

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}

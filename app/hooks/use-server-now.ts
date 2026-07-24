"use client";

import { useEffect, useState } from "react";

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
 */
export function useServerNow(
  serverIso?: string | null,
  tickMs = 30_000
): number {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!serverIso) return;
    const server = Date.parse(serverIso);
    if (Number.isFinite(server)) {
      setOffset(server - Date.now());
      setNow(Date.now());
    }
  }, [serverIso]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return now + offset;
}

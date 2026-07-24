/**
 * Décalage Europe/Paris ↔ UTC (minutes) pour un instant donné.
 * CET = UTC+1 (hiver) / CEST = UTC+2 (été, DST) — jamais figé, contrairement
 * à un offset codé en dur qui serait faux la moitié de l’année (ex: serveur
 * en TZ=UTC, ce qui est le cas par défaut sur la plupart des plateformes
 * cloud, indépendamment de l’heure d’été/hiver française).
 */
export function parisUtcOffsetMinutes(at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(tzName);
    if (m) {
      const hours = Number(m[1]);
      const minutes = m[2] ? Number(m[2]) : 0;
      return (hours >= 0 ? 1 : -1) * (Math.abs(hours) * 60 + minutes);
    }
  } catch {
    /* ignore */
  }
  return 60; // repli CET (UTC+1)
}

/** Instant UTC correspondant à une heure locale Europe/Paris (Y-M-D hh:mm). */
export function parisLocalToUtcIso(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number
): string {
  const naiveUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offsetMin = parisUtcOffsetMinutes(naiveUtc);
  return new Date(naiveUtc.getTime() - offsetMin * 60_000).toISOString();
}

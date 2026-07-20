/**
 * Timestamps Zerion → Europe/Paris.
 * Format obligatoire : DD-MM-YYYY HH:mm:ss
 */

export function formatParisDateTime(
  raw: number | string | Date | null | undefined
): string | null {
  let date: Date | null = null;
  if (raw instanceof Date) {
    date = Number.isNaN(raw.getTime()) ? null : raw;
  } else if (typeof raw === "string" && /T|\d{4}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    date = Number.isNaN(d.getTime()) ? null : d;
  } else if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      const ms = n > 1e12 ? n : n * 1000;
      date = new Date(ms);
      if (Number.isNaN(date.getTime())) date = null;
    }
  }
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function toOccurredAtIso(
  raw: number | string | Date | null | undefined
): string | null {
  let date: Date | null = null;
  if (raw instanceof Date) {
    date = Number.isNaN(raw.getTime()) ? null : raw;
  } else if (typeof raw === "string") {
    const d = new Date(raw);
    date = Number.isNaN(d.getTime()) ? null : d;
  } else if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      date = new Date(n > 1e12 ? n : n * 1000);
    }
  }
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

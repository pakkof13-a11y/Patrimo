/** French-friendly number & date parsing for CSV imports — robuste multi-locale */

const CURRENCY_CHARS = /[€$£¥%₿\s\u00a0\u202f\u2007\u2009']/g;
/** Codes monétaires collés (export Revolut crypto FR) */
const CURRENCY_CODE_SUFFIX = /\s*(EUR|USD|GBP|CHF|JPY|CAD|AUD)\s*$/i;

/**
 * Mois FR (export Revolut / apps FR) — abréviations avec ou sans point.
 * Clé = forme normalisée (sans accent, minuscule, sans point final).
 */
const FR_MONTHS: Record<string, number> = {
  janv: 1,
  jan: 1,
  janvier: 1,
  fevr: 2,
  fev: 2,
  fevrier: 2,
  feb: 2,
  mars: 3,
  mar: 3,
  avr: 4,
  avril: 4,
  apr: 4,
  mai: 5,
  may: 5,
  juin: 6,
  jun: 6,
  juil: 7,
  juillet: 7,
  jul: 7,
  aout: 8,
  aou: 8,
  aug: 8,
  sept: 9,
  sep: 9,
  septembre: 9,
  oct: 10,
  octobre: 10,
  nov: 11,
  novembre: 11,
  dec: 12,
  decembre: 12,
  decembr: 12,
};

function normalizeMonthToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "");
}

/**
 * Nettoie et parse un nombre :
 * - symboles monétaires (€, $, EUR…), espaces insécables
 * - décimales FR (1.234,56) / EN (1,234.56) / crypto FR (0,00000502)
 * - parenthèses négatives
 */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(CURRENCY_CODE_SUFFIX, "");
  // Préfixe monétaire export Revolut Invest : "USD 51.99", "EUR -360"
  s = s.replace(/^(EUR|USD|GBP|CHF|JPY|CAD|AUD)\s+/i, "");
  s = s.replace(CURRENCY_CHARS, "").replace(/'/g, "");
  // Caractères corrompus d’encodage (euro / espaces → ?)
  s = s.replace(/\?/g, "");
  // Unicode minus / en-dash
  s = s.replace(/[−–—]/g, "-");

  // Parenthèses négatives comptables avant nettoyage agressif
  if (/^\(.*\)$/.test(s)) {
    s = "-" + s.slice(1, -1);
  }

  // Tout caractère non numérique restant (sauf . , -)
  s = s.replace(/[^\d.,\-]/g, "");

  if (!s || s === "-" || s === "." || s === ",") return null;

  // both separators present
  if (/,/.test(s) && /\./.test(s)) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      // 1.234,56 → FR
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,234.56 → EN
      s = s.replace(/,/g, "");
    }
  } else if (/,/.test(s) && !/\./.test(s)) {
    // Uniquement virgules :
    // - 1,234,567 → milliers EN (plusieurs virgules)
    // - 1,23 ou 0,00000502 ou 2,53384547 → décimal FR (une virgule)
    // - 1,234 → ambigu : si exactement 3 chiffres après et partie entière ≥ 4? On privilégie
    //   décimal FR pour 1 seule virgule (crypto / cours FR) sauf motif milliers répété.
    const commas = (s.match(/,/g) || []).length;
    if (commas > 1) {
      s = s.replace(/,/g, "");
    } else {
      // Une seule virgule → toujours décimal FR (quantités crypto multi-décimales)
      s = s.replace(",", ".");
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse de dates multi-formats :
 * ISO, DD/MM/YYYY, MM/DD/YYYY (si ambigu privilégie FR),
 * "15 Mar 2024", "9 mai 2026, 20:02:43" (FR Revolut), Unix, Excel serial.
 */
export function parseDate(raw: string | undefined | null): Date | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Coinbase 2024–2026 : "2026-07-17 21:38:42 UTC" (le mot UTC contient "T"
  // → ne pas confondre avec un ISO "T" séparateur)
  s = s.replace(/\s+(UTC|GMT)\s*$/i, "Z");

  // ISO-like YYYY-MM-DD[THH:mm:ss][Z]
  // IBKR Activity Statement : "2025-10-21, 03:17:30" (virgule après la date)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const ibkr = s.replace(
      /^(\d{4}-\d{2}-\d{2}),\s*(\d{1,2}:\d{2}(?::\d{2})?)/,
      "$1 $2"
    );
    if (ibkr !== s) s = ibkr;
    // Essai direct (gère bien "YYYY-MM-DD HH:mm:ssZ" et variantes Node)
    let d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
    // Normalise espace → T pour les parsers stricts
    const iso = s.includes("T") ? s : s.replace(" ", "T");
    d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
    // Sans fuseau : tenter Z
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) {
      d = new Date(iso + "Z");
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  }

  // DD/MM/YYYY[ HH:mm[:ss]] or DD-MM-YYYY or DD.MM.YYYY
  const m = s.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    // Ambiguïté US vs FR : si premier > 12 → jour (FR), si second > 12 → mois US
    if (day > 12 && month <= 12) {
      // day/month OK as FR
    } else if (month > 12 && day <= 12) {
      const t = day;
      day = month;
      month = t;
    }
    const hour = Number(m[4] ?? 12);
    const min = Number(m[5] ?? 0);
    const sec = Number(m[6] ?? 0);
    const d = new Date(year, month - 1, day, hour, min, sec);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // "9 mai 2026, 20:02:43" / "7 févr. 2023, 21:58:19" / "15 Mar 2024"
  const frNamed = s.match(
    /^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})(?:\s*,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i
  );
  if (frNamed) {
    const day = Number(frNamed[1]);
    const mon = FR_MONTHS[normalizeMonthToken(frNamed[2]!)];
    const year = Number(frNamed[3]);
    if (mon && day >= 1 && day <= 31) {
      const hour = Number(frNamed[4] ?? 12);
      const min = Number(frNamed[5] ?? 0);
      const sec = Number(frNamed[6] ?? 0);
      const d = new Date(year, mon - 1, day, hour, min, sec);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // "Mar 15, 2024" / "Mar 15 2024"
  const enNamed = s.match(
    /^([A-Za-z.]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (enNamed) {
    const mon = FR_MONTHS[normalizeMonthToken(enNamed[1]!)];
    const day = Number(enNamed[2]);
    const year = Number(enNamed[3]);
    if (mon && day >= 1 && day <= 31) {
      const hour = Number(enNamed[4] ?? 12);
      const min = Number(enNamed[5] ?? 0);
      const sec = Number(enNamed[6] ?? 0);
      const d = new Date(year, mon - 1, day, hour, min, sec);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // "15 Mar 2024" / "Mar 15, 2024" via engine (EN only)
  const named = Date.parse(s);
  if (!Number.isNaN(named)) {
    if (!/^\d+$/.test(s)) {
      return new Date(named);
    }
  }

  // Unix ms or s
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Excel serial date (days since 1899-12-30), typical range
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 60000) {
      const utc = Date.UTC(1899, 11, 30) + serial * 86400000;
      const d = new Date(utc);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Convertit une date/heure murale US Eastern Time (IBKR "Trade execution
 * times are displayed in Eastern Time") en instant UTC — DST-aware
 * (EST -05:00 / EDT -04:00) sans dépendance à une lib de fuseaux.
 * Stratégie : essayer les deux offsets possibles et garder celui qui,
 * reformaté en America/New_York, redonne l'heure murale d'origine.
 */
export function parseEasternDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date | null {
  for (const offsetHours of [4, 5]) {
    const candidateMs = Date.UTC(year, month - 1, day, hour + offsetHours, minute, second);
    const parts = ET_FORMATTER.formatToParts(new Date(candidateMs));
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === t)?.value ?? NaN);
    if (
      get("year") === year &&
      get("month") === month &&
      get("day") === day &&
      get("hour") === hour &&
      get("minute") === minute &&
      get("second") === second
    ) {
      return new Date(candidateMs);
    }
  }
  return null;
}

/**
 * Parse "YYYY-MM-DD, HH:MM:SS" (format IBKR Trades Date/Time) comme heure
 * Eastern Time et renvoie l'instant UTC équivalent (ou null si invalide).
 */
export function parseIbkrEasternDateTime(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return parseEasternDateTimeToUtc(
    Number(y),
    Number(mo),
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? "0")
  );
}

/** Extrait un code devise depuis un champ Prix/Value Revolut ("1,00 CHF", "0,35€"). */
export function extractCurrencyHint(
  ...fields: Array<string | undefined | null>
): string | null {
  for (const f of fields) {
    if (!f) continue;
    const s = String(f);
    const code = s.match(/\b(EUR|USD|GBP|CHF|JPY|CAD|AUD)\b/i);
    if (code) return code[1]!.toUpperCase();
    if (/€/.test(s)) return "EUR";
    if (/\$/.test(s)) return "USD";
    if (/£/.test(s)) return "GBP";
  }
  return null;
}

export function toIsoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Décode un buffer fichier en texte (UTF-8 avec fallback latin1). */
export function decodeCsvBuffer(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // BOM UTF-8
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  // BOM UTF-16 LE
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Heuristique : trop de � → latin1
    if ((utf8.match(/\uFFFD/g) || []).length > 0) {
      return new TextDecoder("iso-8859-1").decode(bytes);
    }
    return utf8;
  } catch {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }
}

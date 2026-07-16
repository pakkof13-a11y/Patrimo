/** French-friendly number & date parsing for CSV imports — robuste multi-locale */

const CURRENCY_CHARS = /[€$£¥%₿\s\u00a0\u202f\u2007\u2009']/g;

/**
 * Nettoie et parse un nombre :
 * - symboles monétaires (€, $, …), espaces insécables
 * - décimales FR (1.234,56) / EN (1,234.56)
 * - parenthèses négatives
 */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(CURRENCY_CHARS, "").replace(/'/g, "");
  // Unicode minus / en-dash
  s = s.replace(/[−–—]/g, "-");

  if (/^\(.*\)$/.test(s)) {
    s = "-" + s.slice(1, -1);
  }

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
    // only comma → decimal if 1-2 digits after, else thousands
    const m = s.match(/,(\d+)$/);
    if (m && m[1]!.length <= 2) {
      s = s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  }

  // trailing percent already stripped
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse de dates multi-formats :
 * ISO, DD/MM/YYYY, MM/DD/YYYY (si ambigu privilégie FR),
 * "15 Mar 2024", Unix epoch, Excel serial (approx).
 */
export function parseDate(raw: string | undefined | null): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // ISO-like YYYY-MM-DD[THH:mm:ss]
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
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
      // month/day swapped (US written as m/d but we parsed d/m)
      const t = day;
      day = month;
      month = t;
    }
    // else prefer FR (day, month)
    const hour = Number(m[4] ?? 12);
    const min = Number(m[5] ?? 0);
    const sec = Number(m[6] ?? 0);
    const d = new Date(year, month - 1, day, hour, min, sec);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // "15 Mar 2024" / "Mar 15, 2024"
  const named = Date.parse(s);
  if (!Number.isNaN(named)) {
    // Reject pure numbers already handled
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

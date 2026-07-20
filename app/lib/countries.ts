/**
 * Country / region helpers for macro calendar + flag-icons (MIT).
 * SVG source: flag-icon-css via cdnjs (4x3).
 *
 * @see https://cdnjs.cloudflare.com/ajax/libs/flag-icon-css/3.5.0/flags/4x3/
 */

const FLAG_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/flag-icon-css/3.5.0/flags/4x3";

/**
 * Map display / macro codes → ISO-3166-1 alpha-2 (lowercase) for flag-icons.
 * Non-ISO labels (EZ, UK, EA…) are normalized.
 */
const ISO_MAP: Record<string, string> = {
  us: "us",
  usa: "us",
  uk: "gb",
  gb: "gb",
  de: "de",
  fr: "fr",
  it: "it",
  es: "es",
  ch: "ch",
  jp: "jp",
  cn: "cn",
  ca: "ca",
  au: "au",
  nz: "nz",
  nl: "nl",
  hk: "hk",
  /** Eurozone / Euro area → EU flag */
  ez: "eu",
  eu: "eu",
  ea: "eu",
  emu: "eu",
};

/** Normalize any country token to ISO alpha-2 lowercase for SVG path. */
export function toIsoAlpha2(code: string): string {
  const raw = (code || "").trim().toLowerCase();
  if (!raw) return "un";
  if (ISO_MAP[raw]) return ISO_MAP[raw]!;
  // Already looks like alpha-2
  if (/^[a-z]{2}$/.test(raw)) return raw;
  return "un";
}

/** Display label (2 letters, uppercase) kept next to the flag. */
export function countryCodeLabel(code: string): string {
  const c = (code || "??").trim().toUpperCase();
  if (c === "GB") return "UK";
  if (c === "EU") return "EZ";
  return c.slice(0, 2);
}

/** Absolute SVG URL from flag-icon-css CDN (MIT). */
export function flagIconSvgUrl(code: string): string {
  const iso = toIsoAlpha2(code);
  return `${FLAG_CDN}/${iso}.svg`;
}

/** @deprecated emoji fallback — prefer flagIconSvgUrl / CountryFlag */
export function countryFlag(code: string): string {
  const iso = toIsoAlpha2(code);
  const emoji: Record<string, string> = {
    us: "🇺🇸",
    gb: "🇬🇧",
    de: "🇩🇪",
    fr: "🇫🇷",
    it: "🇮🇹",
    es: "🇪🇸",
    ch: "🇨🇭",
    jp: "🇯🇵",
    cn: "🇨🇳",
    ca: "🇨🇦",
    au: "🇦🇺",
    eu: "🇪🇺",
  };
  return emoji[iso] ?? "🏳️";
}

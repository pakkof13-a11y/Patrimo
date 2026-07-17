import { headers } from "next/headers";

/**
 * IP client pour rate-limit login (proxy-aware).
 * Best-effort — en local souvent "unknown" ou ::1.
 */
export async function getLoginClientIp(): Promise<string> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first.slice(0, 64);
    }
    const real = h.get("x-real-ip")?.trim();
    if (real) return real.slice(0, 64);
    const cf = h.get("cf-connecting-ip")?.trim();
    if (cf) return cf.slice(0, 64);
  } catch {
    /* hors contexte request */
  }
  return "unknown";
}

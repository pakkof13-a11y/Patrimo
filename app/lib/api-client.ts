import type { QueryClient } from "@tanstack/react-query";
import type { HoldingsResponse } from "@/app/lib/types/ui";

/**
 * Normalise n'importe quelle valeur d'erreur en message lisible.
 * Évite le piège classique `new Error(object)` → message "[object Object]".
 */
export function toErrorMessage(
  value: unknown,
  fallback = "Erreur inconnue"
): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const t = value.trim();
    return t && t !== "[object Object]" ? t : fallback;
  }
  if (value instanceof Error) {
    const m = value.message?.trim();
    if (m && m !== "[object Object]") return m;
    return value.name && value.name !== "Error" ? value.name : fallback;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (o.error != null && o.error !== value) {
      return toErrorMessage(o.error, fallback);
    }
    if (typeof o.code === "string" && o.code) {
      return o.code;
    }
    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}" && json !== "null") return json.slice(0, 280);
    } catch {
      /* circular */
    }
  }
  const s = String(value);
  return s && s !== "[object Object]" ? s : fallback;
}

/**
 * Safe JSON fetch: never calls .json() blindly on empty/non-JSON bodies.
 * Maps 409 → clear French message for duplicates.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...(init?.headers || {}),
    },
  });

  const contentType = res.headers.get("content-type") || "";
  const hasJson = contentType.includes("application/json");
  let data: { error?: unknown; message?: unknown; details?: unknown } | null =
    null;

  if (hasJson) {
    try {
      data = (await res.json()) as {
        error?: unknown;
        message?: unknown;
        details?: unknown;
      };
    } catch {
      data = null;
    }
  } else {
    // Avoid "Failed to execute 'json' on 'Response'" on empty/HTML bodies
    try {
      const text = await res.text();
      if (text?.trim().startsWith("{")) {
        data = JSON.parse(text) as {
          error?: unknown;
          message?: unknown;
          details?: unknown;
        };
      }
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    let fromBody =
      toErrorMessage(data?.error, "") ||
      toErrorMessage(data?.message, "") ||
      "";
    // Enrichit « Validation échouée » avec details.fieldErrors si présents
    if (
      (!fromBody || fromBody === "Validation échouée") &&
      data?.details &&
      typeof data.details === "object"
    ) {
      const fe = (data.details as { fieldErrors?: Record<string, string[]> })
        .fieldErrors;
      if (fe && typeof fe === "object") {
        const parts = Object.entries(fe)
          .filter(([, v]) => Array.isArray(v) && v.length > 0)
          .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`);
        if (parts.length) fromBody = parts.join(" · ");
      }
    }
    if (res.status === 409) {
      throw new Error(
        fromBody || "Cette plateforme existe déjà dans votre liste"
      );
    }
    if (res.status >= 500) {
      throw new Error(fromBody || "Erreur serveur, veuillez réessayer");
    }
    throw new Error(fromBody || `Erreur (${res.status})`);
  }

  // 204 / 205 : corps intentionnellement vide (mutations sans payload)
  if (data == null && (res.status === 204 || res.status === 205)) {
    return undefined as T;
  }

  // Ne pas masquer un corps vide en `{} as T` (faux positif silencieux)
  if (data == null) {
    throw new Error("Réponse serveur vide ou non-JSON");
  }

  return data as T;
}

/**
 * Force a fresh holdings reload after mutations / price refresh.
 * Met à jour le cache en place (pas d'invalidate qui re-fetch et clignote).
 */
export async function reloadHoldings(qc: QueryClient, baseCurrency: string) {
  const bust = `/api/holdings?base=${encodeURIComponent(baseCurrency)}&_=${Date.now()}`;
  const data = await fetchJson<HoldingsResponse>(bust);
  qc.setQueryData(["holdings", baseCurrency], data);
  // Ne pas invalidateQueries ici : setQueryData suffit et évite un 2e GET + flash UI
  return data;
}

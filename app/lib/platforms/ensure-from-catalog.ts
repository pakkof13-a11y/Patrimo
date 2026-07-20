/**
 * Client : crée (upsert) une plateforme à partir d’un preset catalogue.
 */

import { fetchJson } from "@/app/lib/api-client";
import type { PlatformPreset } from "@/app/lib/platforms/presets";
import { findPreset, primaryType } from "@/app/lib/platforms/presets";

export type EnsuredPlatform = {
  id: string;
  name: string;
  type: string;
  logoUrl: string | null;
  created: boolean;
};

export async function ensurePlatformFromPreset(
  presetOrKey: PlatformPreset | string
): Promise<EnsuredPlatform> {
  const preset =
    typeof presetOrKey === "string"
      ? findPreset(presetOrKey)
      : presetOrKey;

  if (!preset) {
    throw new Error("Courtier inconnu du catalogue");
  }

  const res = await fetchJson<{
    platform: {
      id: string;
      name: string;
      type: string;
      logoUrl: string | null;
    };
    created?: boolean;
  }>("/api/platforms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: preset.name,
      type: primaryType(preset),
      subtype: preset.subtype ?? null,
      logoKey: preset.key,
      logoUrl: preset.logoUrl,
      upsert: true,
    }),
  });

  return {
    id: res.platform.id,
    name: res.platform.name,
    type: res.platform.type,
    logoUrl: res.platform.logoUrl,
    created: res.created !== false,
  };
}

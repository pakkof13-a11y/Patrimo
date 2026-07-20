import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  PLATFORM_PRESETS,
  filterPresets,
  presetTypesLabel,
  primaryType,
  type PlatformPreset,
} from "@/app/lib/platforms/presets";
import { PLATFORM_TYPES } from "@/app/lib/constants";

/**
 * GET /api/platforms/catalog?q=
 * Liste les courtiers / plateformes connus avec logos (catalogue statique).
 * Authentifié — pas de données tenant.
 * `type` = type primaire ; `types` = multi-types catalogue.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  const list: PlatformPreset[] = q ? filterPresets(q) : PLATFORM_PRESETS;

  const presets = list.map((p) => {
    const primary = primaryType(p);
    return {
      key: p.key,
      name: p.name,
      type: primary,
      types: p.types,
      typeLabel: PLATFORM_TYPES[primary] || primary,
      typesLabel: presetTypesLabel(p, PLATFORM_TYPES),
      subtype: p.subtype ?? null,
      category: p.category ?? null,
      logoUrl: p.logoUrl,
      domain: p.domain ?? null,
    };
  });

  return NextResponse.json({
    presets,
    count: presets.length,
  });
}

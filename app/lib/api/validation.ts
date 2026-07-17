import { NextResponse } from "next/server";
import type { ZodError, ZodType } from "zod";

/** Uniform 400 shape for Zod failures across PUT/PATCH/POST. */
export function validationErrorResponse(error: ZodError) {
  return NextResponse.json(
    { error: "Validation échouée", details: error.flatten() },
    { status: 400 }
  );
}

/**
 * Keep only keys actually present on the request body.
 * Avoids Zod `.default()` filling missing fields on `schema.partial()` updates
 * (which would silently overwrite DB values).
 */
export function presentFields<T extends Record<string, unknown>>(
  body: unknown,
  data: T
): Partial<T> {
  if (!body || typeof body !== "object") return {};
  const src = body as Record<string, unknown>;
  const out: Partial<T> = {};
  for (const key of Object.keys(data) as (keyof T)[]) {
    if (Object.prototype.hasOwnProperty.call(src, key as string)) {
      out[key] = data[key];
    }
  }
  return out;
}

/** Parse body with Zod; on failure return a 400 NextResponse. */
export function safeParseBody<T>(
  schema: ZodType<T>,
  body: unknown
): { success: true; data: T } | { success: false; response: NextResponse } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { success: false, response: validationErrorResponse(parsed.error) };
  }
  return { success: true, data: parsed.data };
}

/** Require a non-empty string id from body.id (common PUT pattern). */
export function requireBodyId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as { id?: unknown }).id;
  if (typeof id !== "string" || !id.trim()) return null;
  return id.trim();
}

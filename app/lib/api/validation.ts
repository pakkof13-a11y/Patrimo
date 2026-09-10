import { NextResponse } from "next/server";
import type { ZodError, ZodType } from "zod";
import { BASE_CURRENCY_OPTIONS } from "../money/currencies";

/** Message humain à partir d’un ZodError (champs + form). */
export function formatZodErrorMessage(error: ZodError): string {
  const flat = error.flatten();
  const fieldMsgs: string[] = [];
  for (const [key, raw] of Object.entries(flat.fieldErrors)) {
    const msgs = Array.isArray(raw)
      ? raw.filter((m): m is string => typeof m === "string")
      : [];
    if (msgs.length === 0) continue;
    fieldMsgs.push(`${key}: ${msgs.join(", ")}`);
  }
  if (fieldMsgs.length > 0) return fieldMsgs.join(" · ");
  if (flat.formErrors.length > 0) return flat.formErrors.join(" · ");
  return "Validation échouée";
}

/** Uniform 400 shape for Zod failures across PUT/PATCH/POST. */
export function validationErrorResponse(error: ZodError) {
  return NextResponse.json(
    {
      error: formatZodErrorMessage(error),
      details: error.flatten(),
    },
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

/**
 * La devise de restitution demandée, validée.
 *
 * Elle partait du query string droit dans `convertFromEurSync`, qui lève sur
 * tout code sans taux : `?base=ZZZ` rendait un 500 sans corps là où la demande
 * est simplement invalide. Le remède a été écrit trois fois (D39, D41) ; il
 * vit ici.
 *
 * Rend la devise en majuscules, ou une réponse 400 toute faite.
 */
const attendues = BASE_CURRENCY_OPTIONS.join(", ");

export function requestedBase(
  req: Request
): { base: string } | { error: NextResponse } {
  const demande = new URL(req.url).searchParams.get("base");
  const base = (demande || "EUR").toUpperCase();
  if (!(BASE_CURRENCY_OPTIONS as readonly string[]).includes(base)) {
    return {
      error: NextResponse.json(
        {
          error: `Devise de restitution inconnue : ${base}. Attendu : ${attendues}.`,
        },
        { status: 400 }
      ),
    };
  }
  return { base };
}

/**
 * Une conversion impossible sur une ligne déjà en base — pas la faute de
 * l'appelant, dont la devise vient d'être validée. 503 le dit et nomme la
 * devise fautive ; un 500 nu laissait l'écran mort sans un mot.
 */
export function fxUnavailableResponse(currency: string) {
  return NextResponse.json(
    {
      error: `Taux de change indisponible pour ${currency}. Le total sera exact dès que le taux sera connu.`,
    },
    { status: 503 }
  );
}

/**
 * Le corps JSON d'une requête, ou `null` s'il est illisible.
 *
 * `req.json()` lève avant que `safeParse` n'ait rien à dire : la réponse est
 * alors un 500 sans forme JSON, là où `validationErrorResponse` existe pour
 * dire ce qui manque. Le remède a été posé route par route (D32, D39, D40) ;
 * il vit ici à partir de maintenant.
 *
 * Le repli habituel — `.catch(() => ({}))` — suffit quand l'identifiant est
 * dans le corps : `requireBodyId` refuse alors l'objet vide. Il ne suffit
 * pas quand l'identifiant vient de l'URL et que le schéma est `.partial()` :
 * un `{}` traverse tout, et la route répond 200 sans avoir rien écrit.
 * Répondre « c'est fait » à une requête qu'on n'a pas su lire est le même
 * mensonge qu'un `deleteMany` sans effet annoncé réussi.
 *
 * Un JSON valide qui n'est pas un objet — `"5"`, `[]`, `null` — est refusé
 * pour la même raison : ce n'est pas une requête interprétable.
 */
export async function readJsonBody(
  req: Request
): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

/** La réponse qui va avec `readJsonBody` quand il rend `null`. */
export function unreadableBodyResponse() {
  return NextResponse.json(
    { error: "Corps de requête illisible" },
    { status: 400 }
  );
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

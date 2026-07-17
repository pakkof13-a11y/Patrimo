import { EMPLOYEE_SAVINGS_CSV_TEMPLATE } from "@/app/lib/employee-savings/csv";
import { requireUserId } from "@/app/lib/auth-helpers";

/** Modèle CSV épargne salariale — session requise (defense-in-depth). */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Non authentifié" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(EMPLOYEE_SAVINGS_CSV_TEMPLATE, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="patrimo-epargne-salariale.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}

import { EMPLOYEE_SAVINGS_CSV_TEMPLATE } from "@/app/lib/employee-savings/csv";

export async function GET() {
  return new Response(EMPLOYEE_SAVINGS_CSV_TEMPLATE, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="patrimo-epargne-salariale.csv"',
    },
  });
}

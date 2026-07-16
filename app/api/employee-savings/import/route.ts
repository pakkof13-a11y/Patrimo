import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { parseEmployeeSavingsCsv } from "@/app/lib/employee-savings/csv";
import {
  importEmployeeSavingsLines,
  listEmployeeSavings,
} from "@/app/lib/employee-savings/service";

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }

  let csvText = "";
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (file instanceof File) {
      csvText = await file.text();
    } else if (typeof form.get("csvText") === "string") {
      csvText = String(form.get("csvText"));
    }
  } else {
    const body = await req.json().catch(() => ({}));
    csvText = String(body?.csvText || "");
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: "CSV vide" }, { status: 400 });
  }

  const parsed = parseEmployeeSavingsCsv(csvText);
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        error: "Aucune ligne valide",
        parseErrors: parsed.errors,
      },
      { status: 400 }
    );
  }

  const result = await importEmployeeSavingsLines(userId, parsed.rows);
  const data = await listEmployeeSavings(userId);

  return NextResponse.json({
    ...result,
    parseErrors: parsed.errors,
    delimiter: parsed.delimiter,
    lines: data.lines,
    summary: data.summary,
  });
}

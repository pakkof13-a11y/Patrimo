import fs from "fs";
import { importCsv } from "../app/lib/import/import-csv";
import { parseCsv } from "../app/lib/import/csv-parse";
import { detectBestAdapter } from "../app/lib/import/adapters/registry";
import { normalizeHeader } from "../app/lib/import/csv-parse";

const p =
  "C:/Users/Pak-M/Downloads/24768445-1d2b-51cd-86df-c66f9475e38b_2026_85f9f81b-c66c-5258-ba9e-e363f95ec073__csv_.csv";
const text = fs.readFileSync(p, "utf8");
const parsed = parseCsv(text);
console.log("headers", parsed.headers);
console.log(
  "norm",
  parsed.headers.map((h) => normalizeHeader(h))
);
console.log("rows", parsed.rows.length);
console.log("row0", parsed.rows[0]);
const det = detectBestAdapter(parsed.headers);
console.log(
  "detect",
  det.adapter.meta.id,
  det.score,
  det.ranking.slice(0, 6)
);
const r = importCsv(text, { formatId: "auto" });
console.log("format", r.formatId, r.formatLabel, r.confidence);
console.log(
  "stats",
  r.drafts.length,
  "ok",
  r.drafts.filter((d) => d.status === "ok").length,
  "err",
  r.drafts.filter((d) => d.status === "error").length,
  "warn",
  r.drafts.filter((d) => d.status === "warning").length
);
console.log(
  "sample",
  r.drafts.slice(0, 5).map((d) => ({
    type: d.type,
    ticker: d.ticker,
    qty: d.quantity,
    price: d.unitPrice,
    status: d.status,
    errors: d.errors,
    warnings: d.warnings,
  }))
);
console.log("types", [...new Set(r.drafts.map((d) => d.type))]);

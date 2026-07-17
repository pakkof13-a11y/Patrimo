import fs from "fs";
import { parseCsv } from "../app/lib/import/csv-parse";
import { mapCsvToDrafts } from "../app/lib/import/map-rows";
import { detectBestAdapter } from "../app/lib/import/adapters/registry";
import { parseDate, parseNumber, decodeCsvBuffer } from "../app/lib/import/normalize";
import type { ImportFormatId } from "../app/lib/import/presets";

const revPath =
  "C:/Users/Pak-M/Downloads/Analyse/crypto-account-statement_2020-02-08_2026-07-17_fr-fr_bc20d3.csv";
const patPath = "C:/Users/Pak-M/Downloads/Analyse/patrimo_crypto_import.csv";

console.log("parseDate fr:", parseDate("7 févr. 2023, 21:58:19"));
console.log("parseDate fr2:", parseDate("9 mai 2026, 20:02:43"));
console.log("parseDate ddmm:", parseDate("07/02/2023"));
console.log("parseNumber price:", parseNumber("69?635,02?"));
console.log("parseNumber nbsp:", parseNumber("69\u202f635,02€"));
console.log("parseNumber qty:", parseNumber("2,53384547"));
console.log("parseNumber clean:", parseNumber("69635.02"));

function summarize(label: string, text: string, formatId?: string) {
  const csv = parseCsv(text);
  const detected = detectBestAdapter(csv.headers);
  const ranking = detected.ranking;
  console.log("\n===", label, "===");
  console.log("headers:", csv.headers.join(" | "));
  console.log("rows:", csv.rows.length);
  console.log(
    "detect:",
    ranking
      .slice(0, 6)
      .map((r) => `${r.id}:${r.score}`)
      .join(", ")
  );
  const fmt = (formatId || detected.adapter.meta.id || "patrimo") as
    | ImportFormatId
    | string;
  const { rows, formatLabel, columnMap } = mapCsvToDrafts(csv, fmt);
  console.log("format used:", fmt, "/", formatLabel);
  console.log("columnMap:", columnMap);

  const counts = { ok: 0, warning: 0, error: 0, selected: 0 };
  const errMsg = new Map<string, number>();
  const warnMsg = new Map<string, number>();
  const types = new Map<string, number>();
  for (const r of rows) {
    counts[r.status]++;
    if (r.selected) counts.selected++;
    for (const e of r.errors) errMsg.set(e, (errMsg.get(e) || 0) + 1);
    for (const w of r.warnings) warnMsg.set(w, (warnMsg.get(w) || 0) + 1);
    const t = r.type || "null";
    types.set(t, (types.get(t) || 0) + 1);
  }
  console.log("status:", counts);
  console.log(
    "types:",
    [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  );
  console.log(
    "top errors:",
    [...errMsg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  );
  console.log(
    "top warnings:",
    [...warnMsg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  );

  for (const e of rows.filter((r) => r.status === "error").slice(0, 6)) {
    console.log(
      "ERR L" + e.line,
      e.errors,
      "| type=",
      e.type,
      "ticker=",
      e.ticker,
      "qty=",
      e.quantity,
      "px=",
      e.unitPrice,
      "rawType=",
      e.raw["Type"] || e.raw["type"],
      "rawDate=",
      e.raw["Date"] || e.raw["date"],
      "rawPrice=",
      e.raw["Price"] || e.raw["unit_price"] || e.raw["Price"]
    );
  }
  for (const w of rows.filter((r) => r.status === "warning").slice(0, 4)) {
    console.log(
      "WARN L" + w.line,
      w.warnings,
      w.type,
      w.ticker,
      "qty",
      w.quantity,
      "px",
      w.unitPrice,
      "cash",
      w.cashAmount
    );
  }
}

const revBuf = fs.readFileSync(revPath);
const revText = decodeCsvBuffer(revBuf);
const revCsv = parseCsv(revText);
const typeSet = new Map<string, number>();
for (const r of revCsv.rows) {
  const t = r["Type"] || r["type"] || "";
  typeSet.set(t, (typeSet.get(t) || 0) + 1);
}
console.log(
  "Revolut Type values:",
  [...typeSet.entries()].sort((a, b) => b[1] - a[1])
);
// sample raw row bytes for price
const sample = revCsv.rows[3];
if (sample) {
  console.log("sample row Price chars:", [...(sample["Price"] || "")].map((c) => c + ":" + c.charCodeAt(0)));
  console.log("sample Date:", sample["Date"]);
}

summarize("REVOLUT raw auto", revText);
summarize("REVOLUT forced revolut", revText, "revolut");

const patText = decodeCsvBuffer(fs.readFileSync(patPath));
summarize("PATRIMO converted auto", patText);
summarize("PATRIMO forced patrimo", patText, "patrimo");

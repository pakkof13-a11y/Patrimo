/**
 * Lightweight CSV parser — supports `,` `;` tab delimiters, quoted fields, BOM.
 * Encodage : le texte doit déjà être décodé (voir decodeCsvBuffer).
 */

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  rawLineCount: number;
};

function detectDelimiter(sample: string): string {
  const first = sample.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  // Ignore delimiters inside quotes for rough count
  let semi = 0;
  let comma = 0;
  let tab = 0;
  let inQ = false;
  for (let i = 0; i < first.length; i++) {
    const ch = first[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (inQ) continue;
    if (ch === ";") semi++;
    else if (ch === ",") comma++;
    else if (ch === "\t") tab++;
  }
  if (tab > semi && tab > comma) return "\t";
  if (semi >= comma) return ";";
  return ",";
}

function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function normalizeHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Parse un texte CSV.
 * @param text contenu déjà en UTF-8 (ou latin1 décodé)
 * @param delimiter forcé optionnel
 */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const delim = delimiter || detectDelimiter(cleaned);
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], delimiter: delim, rawLineCount: 0 };
  }

  // Skip pure comment / separator lines sometimes present in broker exports
  let headerIdx = 0;
  while (
    headerIdx < lines.length &&
    (/^#+/.test(lines[headerIdx]!.trim()) ||
      /^sep=/i.test(lines[headerIdx]!.trim()))
  ) {
    // Excel "sep=;" hint
    const sepHint = lines[headerIdx]!.match(/^sep=(.)$/i);
    if (sepHint && !delimiter) {
      // use hint if no explicit delimiter
    }
    headerIdx++;
  }
  if (headerIdx >= lines.length) {
    return { headers: [], rows: [], delimiter: delim, rawLineCount: 0 };
  }

  // Excel sep= line
  let effectiveDelim = delim;
  const sepLine = lines.find((l) => /^sep=/i.test(l.trim()));
  if (sepLine && !delimiter) {
    const m = sepLine.trim().match(/^sep=(.)$/i);
    if (m?.[1]) effectiveDelim = m[1];
  }

  const headers = parseLine(lines[headerIdx]!, effectiveDelim).map((h) =>
    h.replace(/^\uFEFF/, "").trim()
  );
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^sep=/i.test(lines[i]!.trim())) continue;
    const cells = parseLine(lines[i]!, effectiveDelim);
    if (cells.every((c) => !c)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }

  return {
    headers,
    rows,
    delimiter: effectiveDelim,
    rawLineCount: rows.length,
  };
}

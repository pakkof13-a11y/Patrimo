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

/**
 * Si Excel / un éditeur a mis toute la ligne de données entre guillemets,
 * on n'obtient qu'1 cellule (ou bien moins que le nombre de colonnes)
 * alors que le contenu contient encore le délimiteur.
 */
function maybeResplitCollapsedRow(
  cells: string[],
  headerCount: number,
  delimiter: string
): string[] {
  if (headerCount <= 1) return cells;
  const nonEmpty = cells.filter((c) => c.length > 0);
  if (nonEmpty.length !== 1) return cells;
  // Trop de colonnes déjà remplies → rien à faire
  if (cells.filter((c) => c.length > 0).length >= Math.min(3, headerCount)) {
    return cells;
  }
  const blob = nonEmpty[0]!;
  if (!blob.includes(delimiter)) return cells;
  // Re-parse le blob comme une ligne CSV (quotes internes déjà dédoublées)
  const rescanned = parseLine(blob, delimiter);
  if (rescanned.length >= Math.min(headerCount, 3) && rescanned.length > cells.filter(Boolean).length) {
    return rescanned;
  }
  return cells;
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
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], delimiter: ",", rawLineCount: 0 };
  }

  // Délimiteur : préférer une ligne « dense » (pas le disclaimer d’une cellule)
  let delim = delimiter || ",";
  if (!delimiter) {
    let bestD = ",";
    let bestCount = -1;
    for (const line of lines.slice(0, 15)) {
      if (/you can use this|understand and agree|export date/i.test(line)) {
        continue;
      }
      const d = detectDelimiter(line);
      const count =
        d === "\t"
          ? (line.match(/\t/g) || []).length
          : line.split(d).length - 1;
      if (count > bestCount) {
        bestCount = count;
        bestD = d;
      }
    }
    delim = bestD;
  }

  // Excel sep= line
  let effectiveDelim = delim;
  const sepLine = lines.find((l) => /^sep=/i.test(l.trim()));
  if (sepLine && !delimiter) {
    const m = sepLine.trim().match(/^sep=(.)$/i);
    if (m?.[1]) effectiveDelim = m[1];
  }

  /**
   * Trouve la vraie ligne d’en-têtes (exports Coinbase / Crypto.com préambule légal).
   * Score : colonnes « label » (lettres, pas d’email, pas de disclaimer).
   */
  function headerScore(line: string): number {
    const t = line.trim();
    if (!t) return -1;
    if (/^#+/.test(t) || /^sep=/i.test(t)) return -1;
    if (
      /you can use this|understand and agree|export date|export contains|for final tax|as-is/i.test(
        t
      )
    ) {
      return -1;
    }
    const cells = parseLine(t, effectiveDelim).map((c) =>
      c.replace(/^\uFEFF/, "").trim()
    );
    if (cells.length < 3) return -1;
    // Ligne "User,email@…,id"
    if (
      /^user$/i.test(cells[0] || "") &&
      cells.some((c) => c.includes("@"))
    ) {
      return -1;
    }
    let score = 0;
    for (const c of cells) {
      if (!c) continue;
      // Labels d’en-tête (y compris longs type Coinbase)
      if (
        /^[A-Za-z][A-Za-z0-9 _/().'&%-]{1,80}$/.test(c) &&
        !/@/.test(c)
      ) {
        score += 3;
      } else if (/[A-Za-z]{3,}/.test(c) && c.length < 64) {
        score += 1;
      }
      if (/@|\d{4}-\d{2}-\d{2}|^\d+[.,]\d+$/.test(c)) score -= 2;
    }
    // Bonus mots-clés d’en-têtes métier
    const joined = cells.map((c) => c.toLowerCase()).join(" ");
    if (
      /timestamp|date|time|type|amount|quantity|currency|asset|coin|fee|price|transaction/.test(
        joined
      )
    ) {
      score += 8;
    }
    return score;
  }

  let headerIdx = 0;
  let bestScore = -1;
  const scanLimit = Math.min(lines.length, 25);
  for (let i = 0; i < scanLimit; i++) {
    const s = headerScore(lines[i]!);
    if (s > bestScore) {
      bestScore = s;
      headerIdx = i;
    }
  }
  // Aucun candidat plausible → première ligne non sep/comment
  if (bestScore < 0) {
    headerIdx = 0;
    while (
      headerIdx < lines.length &&
      (/^#+/.test(lines[headerIdx]!.trim()) ||
        /^sep=/i.test(lines[headerIdx]!.trim()) ||
        /you can use this|understand and agree|export date|export contains/i.test(
          lines[headerIdx]!
        ))
    ) {
      headerIdx++;
    }
  }
  if (headerIdx >= lines.length) {
    return { headers: [], rows: [], delimiter: delim, rawLineCount: 0 };
  }

  const headers = parseLine(lines[headerIdx]!, effectiveDelim).map((h) =>
    h.replace(/^\uFEFF/, "").trim()
  );
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^sep=/i.test(lines[i]!.trim())) continue;
    let cells = parseLine(lines[i]!, effectiveDelim);
    // Récupération : export/édition Excel qui a encapsulé toute la ligne
    // dans un seul champ quoté → une seule cellule contenant encore des
    // séparateurs ("DOT,Mise en staking,""2,53"",…"). On re-parse ce champ.
    cells = maybeResplitCollapsedRow(cells, headers.length, effectiveDelim);
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

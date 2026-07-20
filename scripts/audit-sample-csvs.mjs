import fs from "node:fs";
import path from "node:path";

const root = "C:\\Users\\Pak-M\\Downloads\\Patrimo";

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.csv$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

function sniff(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
  let text = buf.toString("utf8");
  if (text.includes("\u0000")) text = buf.toString("utf16le");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  let headerIdx = 0;
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const l = lines[i];
    const commas = (l.match(/,/g) || []).length;
    if (
      commas >= 2 &&
      /[A-Za-z]/.test(l) &&
      !l.startsWith('"You ') &&
      !l.startsWith("You ") &&
      !l.startsWith("Export ") &&
      !/^Transactions\s*$/i.test(l)
    ) {
      headerIdx = i;
      break;
    }
  }
  return {
    header: lines[headerIdx] || "",
    headerIdx,
    nLines: lines.length,
    sample: lines.slice(headerIdx + 1, headerIdx + 3),
  };
}

const files = walk(root);
for (const f of files) {
  const rel = path.relative(root, f);
  try {
    const s = sniff(f);
    console.log("---", rel);
    console.log("  headerIdx", s.headerIdx, "lines", s.nLines);
    console.log("  HDR:", s.header.slice(0, 280));
    if (s.sample[0]) console.log("  ROW:", s.sample[0].slice(0, 200));
  } catch (e) {
    console.log("---", rel, "ERR", e.message);
  }
}

import { importCsv } from "../app/lib/import/import-csv";
import { mapTxType } from "../app/lib/import/presets";
import { parseCsv } from "../app/lib/import/csv-parse";

console.log("map crypto_withdrawal", mapTxType("crypto_withdrawal"));
console.log("map Interest", mapTxType("Interest"));

const csv = `Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash
2023-12-13 21:19:39,Withdraw CRO,CRO,-10.3,,,USD,1.02,1.02,crypto_withdrawal,abc
`;
const r = importCsv(csv, { formatId: "auto" });
console.log("cdc", r.formatId, JSON.stringify(r.drafts[0], null, 2));

const d = `Time (UTC),Coin,Deposit Amount,Fee,Deposit Address,Status,TxId
2021-11-19 11:17:48.000,USDC,100.0,0,ADDR,Completed,tx1
`;
const r2 = importCsv(d, { formatId: "auto" });
console.log("dep", r2.formatId, r2.drafts[0]);

const cb = `"You can use this transaction report to inform your likely tax obligations."

User,test@example.com,abc123
Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
2022-01-01T12:00:00Z,Buy,BTC,0.01,EUR,40000,400,410,10,notes
`;
const parsed = parseCsv(cb);
console.log("cb headers", parsed.headers);
console.log("cb row0", parsed.rows[0]);
const r3 = importCsv(cb, { formatId: "auto" });
console.log("cb format", r3.formatId, r3.drafts[0]?.type, r3.drafts[0]?.errors);

// score debug
const lines = cb.split("\n").filter((l) => l.trim());
console.log("lines", lines.map((l, i) => i + ":" + l.slice(0, 80)));

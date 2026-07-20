/**
 * Configure Vercel Preview env to use Neon staging branch (not production).
 *
 * Usage:
 *   set STAGING_DATABASE_URL=postgresql://…staging…/neondb?sslmode=require
 *   node scripts/setup-vercel-preview-env.mjs
 *
 * Prefer Vercel REST API (CLI `env add preview` prompts for git branch and is fragile).
 * Requires Vercel CLI auth file (already logged in via `vercel login`).
 *
 * Docs: docs/cloud-test-workflow.md
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const PROJECT_ID = "prj_yVLTvDh0m9a9x6F1GMmdSoqh5B8p";
const TEAM_ID = "team_2mkFaC4g1GV2CJBnb09MRhgJ";

const db =
  process.argv[2] ||
  process.env.STAGING_DATABASE_URL ||
  process.env.DATABASE_URL_STAGING;
if (!db) {
  console.error("Missing staging DATABASE_URL (argv or STAGING_DATABASE_URL)");
  process.exit(1);
}

const authSecret =
  process.env.PREVIEW_AUTH_SECRET || randomBytes(32).toString("base64url");

function loadVercelToken() {
  const candidates = [
    join(homedir(), "AppData/Roaming/xdg.data/com.vercel.cli/auth.json"),
    join(homedir(), ".local/share/com.vercel.cli/auth.json"),
    join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const t = j.token || j.accessToken;
      if (t) return t;
    } catch {
      /* next */
    }
  }
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  throw new Error("Vercel token not found — run: npx vercel login");
}

async function listPreviewKeys(token) {
  const url = `https://api.vercel.com/v9/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list env ${res.status}`);
  const data = await res.json();
  return (data.envs || []).filter((e) => (e.target || []).includes("preview"));
}

async function deleteEnv(token, id) {
  const url = `https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${id}?teamId=${TEAM_ID}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok || res.status === 404;
}

async function createEnv(token, key, value, type) {
  const url = `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      value,
      type,
      target: ["preview"],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create ${key}: ${res.status} ${t.slice(0, 200)}`);
  }
  console.log(`OK  ${key} → preview (${type})`);
}

const token = loadVercelToken();
const existing = await listPreviewKeys(token);
for (const e of existing) {
  if (["DATABASE_URL", "AUTH_SECRET", "ALLOW_DEMO_FALLBACK"].includes(e.key)) {
    await deleteEnv(token, e.id);
    console.log(`rm  ${e.key} (old preview)`);
  }
}

await createEnv(token, "DATABASE_URL", db, "sensitive");
await createEnv(token, "AUTH_SECRET", authSecret, "encrypted");
await createEnv(token, "ALLOW_DEMO_FALLBACK", "false", "plain");

console.log(
  "Preview env ready: Neon staging DB. AUTH_URL unset (trustHost = preview host)."
);
console.log("See docs/cloud-test-workflow.md");

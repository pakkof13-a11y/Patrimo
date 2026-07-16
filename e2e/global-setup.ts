/**
 * Ensure demo data exists before E2E suite (idempotent seed).
 */
import { execSync } from "node:child_process";
import path from "node:path";

export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");
  console.log("[e2e] Running prisma seed…");
  execSync("npx tsx prisma/seed.ts", {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      // Dataset léger pour e2e (évite holdings 20s+ / Turbopack sous charge)
      SEED_LIGHT: "1",
      E2E: "1",
    },
  });
  console.log("[e2e] Seed done.");
}

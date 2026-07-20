/**
 * Réinitialise les mots de passe admin + demo (local).
 * Usage: npx tsx scripts/reset-passwords.mts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

const ADMIN_PASS = process.env.RESET_ADMIN_PASS?.trim() || "Kzc48++";
const DEMO_PASS = process.env.RESET_DEMO_PASS?.trim() || "demo1234";

async function main() {
  const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
  const demoHash = await bcrypt.hash(DEMO_PASS, 10);

  const admin = await prisma.user.updateMany({
    where: {
      OR: [{ username: "admin" }, { email: "admin@patrimo.local" }],
    },
    data: { passwordHash: adminHash },
  });
  const demo = await prisma.user.updateMany({
    where: {
      OR: [{ username: "demo" }, { email: "demo@patrimo.fr" }],
    },
    data: { passwordHash: demoHash },
  });

  console.log("updated admin rows:", admin.count);
  console.log("updated demo rows:", demo.count);

  // Sync .env so seed / e2e stay coherent
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, "utf8");
    const set = (key: string, val: string) => {
      const re = new RegExp(`^${key}=.*$`, "m");
      const line = `${key}="${val.replace(/"/g, '\\"')}"`;
      if (re.test(env)) env = env.replace(re, line);
      else env += `\n${line}\n`;
    };
    set("ADMIN_PASSWORD", ADMIN_PASS);
    set("DEMO_PASSWORD", DEMO_PASS);
    set("E2E_PASS", DEMO_PASS);
    fs.writeFileSync(envPath, env, "utf8");
    console.log(".env: ADMIN_PASSWORD / DEMO_PASSWORD / E2E_PASS mis à jour");
  }

  // Verify
  const users = await prisma.user.findMany({
    where: { username: { in: ["admin", "demo"] } },
    select: { username: true, passwordHash: true },
  });
  for (const u of users) {
    const pass = u.username === "admin" ? ADMIN_PASS : DEMO_PASS;
    const ok = u.passwordHash
      ? await bcrypt.compare(pass, u.passwordHash)
      : false;
    console.log("verify", u.username, ok ? "OK" : "FAIL");
  }
  console.log("\nConnexion:");
  console.log("  admin /", ADMIN_PASS);
  console.log("  demo  /", DEMO_PASS);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

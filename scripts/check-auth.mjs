import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Vérifie qu'un utilisateur demo existe et que DEMO_PASSWORD (env) matche le hash.
 * N'affiche jamais le mot de passe en clair.
 */
const pass = process.env.DEMO_PASSWORD?.trim();
if (!pass) {
  console.error("[check-auth] DEMO_PASSWORD manquant dans l'environnement.");
  process.exit(1);
}

const email = process.env.DEMO_EMAIL?.trim() || "demo@patrimo.fr";
const p = new PrismaClient();
const u = await p.user.findUnique({ where: { email } });
console.log("user", u?.email, "hash=", Boolean(u?.passwordHash));
console.log(
  "pw ok",
  u?.passwordHash ? await bcrypt.compare(pass, u.passwordHash) : false
);
console.log("AUTH_SECRET", process.env.AUTH_SECRET ? "set" : "missing");
await p.$disconnect();

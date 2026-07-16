import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const p = new PrismaClient();
const u = await p.user.findUnique({ where: { email: "demo@patrimo.fr" } });
console.log("user", u?.email, !!u?.passwordHash);
console.log("pw ok", u ? await bcrypt.compare("demo1234", u.passwordHash) : false);
console.log("AUTH_SECRET", process.env.AUTH_SECRET ? "set" : "missing");
await p.$disconnect();

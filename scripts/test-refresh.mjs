import "dotenv/config";
import { createPrismaClient } from "@/app/lib/prisma";
import { refreshEligiblePrices } from "../app/lib/market/refresh.ts";

const p = createPrismaClient();
const u = await p.user.findUnique({ where: { email: "demo@patrimo.fr" } });
if (!u) throw new Error("no user");
const r = await refreshEligiblePrices(u.id);
console.log(JSON.stringify(r, null, 2));
await p.$disconnect();

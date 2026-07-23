import "dotenv/config";
import { createPrismaClient } from "@/app/lib/prisma";
import bcrypt from "bcryptjs";

const p = createPrismaClient();

async function main() {
  const users = await p.user.findMany({
    select: {
      email: true,
      username: true,
      role: true,
      passwordHash: true,
    },
  });
  console.log(
    "users:",
    users.map((u) => ({
      email: u.email,
      username: u.username,
      role: u.role,
      hasHash: Boolean(u.passwordHash),
    }))
  );

  const adminPass = (process.env.ADMIN_PASSWORD || "").trim();
  const demoPass = (process.env.DEMO_PASSWORD || "").trim();
  console.log("ADMIN_PASSWORD set:", Boolean(adminPass), "len", adminPass.length);
  console.log("DEMO_PASSWORD set:", Boolean(demoPass), "len", demoPass.length);

  const candidates = [
    ["ADMIN_PASSWORD env", adminPass],
    ["DEMO_PASSWORD env", demoPass],
    ["Kzc48++", "Kzc48++"],
    ["demo1234", "demo1234"],
    ["local-dev-admin-change-me", "local-dev-admin-change-me"],
    ["local-dev-demo-change-me", "local-dev-demo-change-me"],
  ];

  for (const u of users) {
    if (!u.passwordHash) continue;
    for (const [label, pass] of candidates) {
      if (!pass) continue;
      const ok = await bcrypt.compare(pass, u.passwordHash);
      if (ok) console.log("MATCH", u.username || u.email, "←", label);
    }
  }

  // Simulate authorize lookup
  for (const login of ["admin", "demo", "admin@patrimo.local", "demo@patrimo.fr"]) {
    const user = await p.user.findFirst({
      where: {
        OR: [
          { username: login },
          { email: login },
          { email: `${login}@patrimo.local` },
        ],
      },
    });
    console.log("lookup", login, "→", user?.username || user?.email || "NOT FOUND");
  }
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());

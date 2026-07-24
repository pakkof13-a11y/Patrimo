import { createPrismaClient } from "@/app/lib/prisma";

const p = createPrismaClient();

async function main() {
  const users = await p.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    const n = await p.transaction.count({ where: { userId: u.id } });
    console.log(u.email, "tx=", n);
    const types = await p.transaction.groupBy({
      by: ["type"],
      where: { userId: u.id },
      _count: true,
    });
    console.log(JSON.stringify(types, null, 2));
    const sample = await p.transaction.findMany({
      where: { userId: u.id },
      orderBy: { occurredAt: "desc" },
      take: 5,
      select: { type: true, notes: true, occurredAt: true },
    });
    console.log("latest:", sample);
  }
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());

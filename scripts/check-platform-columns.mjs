import { createPrismaClient } from "@/app/lib/prisma";

const p = createPrismaClient();
const rows = await p.$queryRaw`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Platform'
  ORDER BY 1
`;
console.log(JSON.stringify(rows, null, 2));
await p.$disconnect();

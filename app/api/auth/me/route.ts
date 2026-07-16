import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth-helpers";

/** Session courante (id, username, role) pour l'UI. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

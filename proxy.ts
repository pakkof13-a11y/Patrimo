/**
 * Next.js 16 : fichier `proxy.ts` (remplace middleware.ts).
 * Protège les routes via le callback `authorized` de NextAuth (auth.ts).
 */
export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./app/lib/prisma";
import { loginSchema } from "./app/lib/schemas";
import { getLoginClientIp } from "./app/lib/auth/login-client-ip";
import {
  checkLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
  GENERIC_LOGIN_ERROR,
} from "./app/lib/auth/login-rate-limit";
import { resolveAuthTrustHost } from "./app/lib/auth/trust-host";

export { resolveAuthTrustHost } from "./app/lib/auth/trust-host";

/**
 * Hash bcrypt factice (coût 10) pour comparer même si l'utilisateur n'existe pas
 * — réduit les fuites par timing (user exists vs wrong password).
 * Phrase fixe non secrète (pas un mot de passe réel).
 */
const DUMMY_PASSWORD_HASH =
  "$2b$10$Wyhz8nCkjAX99Oc.yCM5uOPMCZOy.eiSeG37U08CbAhqUlTbYCG2C";

/** Erreur rate-limit — code stable pour l’UI (sans fuite d’existence de compte). */
class RateLimitedSignIn extends CredentialsSignin {
  code = "rate_limited";
  constructor(public retryAfterSec: number) {
    super(GENERIC_LOGIN_ERROR);
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Identifiant", type: "text" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          // Pas de détail de validation côté client auth — message générique
          return null;
        }

        const login = parsed.data.username.trim().toLowerCase();
        const password = parsed.data.password;
        const ip = await getLoginClientIp();

        const gate = await checkLoginAllowed(ip, login);
        if (gate.blocked) {
          throw new RateLimitedSignIn(gate.retryAfterSec);
        }

        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: login },
              { email: login },
              { email: `${login}@patrimo.local` },
            ],
          },
        });

        const hash = user?.passwordHash || DUMMY_PASSWORD_HASH;
        const ok = await bcrypt.compare(password, hash);

        if (!user?.passwordHash || !ok) {
          await recordLoginFailure(ip, login);
          return null; // → CredentialsSignin générique côté client
        }

        await clearLoginFailures(ip, login);

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.username,
          username: user.username,
          role: user.role === "ADMIN" ? "ADMIN" : "USER",
        };
      },
    }),
  ],
  callbacks: {
    authorized({ auth: session, request }) {
      const path = request.nextUrl.pathname;
      /**
       * Couche 1 — routes publiques intentionnelles uniquement.
       * Liste maintenue aussi dans docs/api-routes-auth.md.
       * Les handlers sensibles doivent encore appeler requireUserId (401 JSON).
       */
      if (
        path.startsWith("/login") ||
        path.startsWith("/api/auth") ||
        path.startsWith("/_next") ||
        path.startsWith("/patrimo") ||
        path === "/favicon.ico" ||
        path === "/icon.jpg" ||
        path === "/apple-icon.jpg" ||
        path === "/api/health"
      ) {
        return true;
      }
      return !!session?.user;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        const u = user as {
          username?: string;
          role?: string;
        };
        token.username = u.username;
        token.role = u.role === "ADMIN" ? "ADMIN" : "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.name = (token.name as string) ?? session.user.name;
        session.user.username = (token.username as string) ?? "";
        session.user.role =
          (token.role as string) === "ADMIN" ? "ADMIN" : "USER";
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  /**
   * trustHost : ne pas faire aveuglément confiance au Host en prod.
   * - AUTH_URL défini → false (URL canonique, anti host-header injection)
   * - Preview Vercel sans AUTH_URL → true (hosts multi-preview)
   * - Override : AUTH_TRUST_HOST=true|false
   * @see resolveAuthTrustHost
   */
  trustHost: resolveAuthTrustHost(),
});

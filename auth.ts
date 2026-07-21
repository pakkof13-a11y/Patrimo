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
import { normalizeRole } from "./app/lib/auth/role";
import { resolveAuthTrustHost } from "./app/lib/auth/trust-host";

export { resolveAuthTrustHost } from "./app/lib/auth/trust-host";

/**
 * Hash bcrypt factice pour comparer même si l'utilisateur n'existe pas
 * (anti timing user-exists vs wrong-password).
 * Généré au runtime à partir d’une phrase publique — aucun hash bcrypt
 * littéral dans le dépôt (évite alertes SAST / gitleaks).
 */
let dummyPasswordHashCache: string | null = null;
function getDummyPasswordHash(): string {
  if (!dummyPasswordHashCache) {
    dummyPasswordHashCache = bcrypt.hashSync(
      "patrimo-timing-dummy-not-a-password",
      10
    );
  }
  return dummyPasswordHashCache;
}

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

        const hash = user?.passwordHash || getDummyPasswordHash();
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
          role: normalizeRole(user.role),
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
        // `user` est typé via types/next-auth.d.ts (User.username, User.role)
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.username = user.username;
        token.role = normalizeRole(user.role);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        // JWT fields typés dans next-auth/jwt (types/next-auth.d.ts)
        // role toujours défini (UserRole) — aligne Session.user.role obligatoire
        session.user.id = token.sub;
        session.user.email = token.email ?? session.user.email;
        session.user.name = token.name ?? session.user.name;
        session.user.username = token.username ?? "";
        session.user.role = normalizeRole(token.role);
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

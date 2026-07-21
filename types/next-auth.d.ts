import "next-auth";
import "next-auth/jwt";

export type UserRole = "ADMIN" | "USER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      username?: string;
      /**
       * Toujours renseigné par le callback `session` (défaut USER).
       * Aligné sur SessionUser.role dans auth-helpers.
       */
      role: UserRole;
    };
  }

  interface User {
    id: string;
    username?: string;
    /** Renseigné à l’authorize / jwt — optionnel seulement avant premier login */
    role?: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    username?: string;
    /** Présent après login ; session callback normalise → USER si absent */
    role?: UserRole;
  }
}

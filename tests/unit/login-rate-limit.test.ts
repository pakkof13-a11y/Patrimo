import { describe, expect, it, beforeEach } from "vitest";
import {
  __peekLoginBucketForTests,
  __resetLoginRateLimitForTests,
  checkLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
  LOGIN_RATE_LIMIT,
  GENERIC_LOGIN_ERROR,
  rateLimitLoginMessage,
} from "@/app/lib/auth/login-rate-limit";

describe("login rate limit", () => {
  beforeEach(() => {
    __resetLoginRateLimitForTests();
  });

  it("autorise les premières tentatives", () => {
    expect(checkLoginAllowed("1.1.1.1", "demo").blocked).toBe(false);
  });

  it("déclenche un cooldown après THRESHOLD échecs sur l’identifiant", () => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.THRESHOLD; i++) {
      recordLoginFailure("1.1.1.1", "victim");
    }
    const gate = checkLoginAllowed("9.9.9.9", "victim");
    expect(gate.blocked).toBe(true);
    if (gate.blocked) {
      expect(gate.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("bloque aussi par IP après plusieurs échecs multi-comptes", () => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.THRESHOLD; i++) {
      recordLoginFailure("2.2.2.2", `user${i}`);
    }
    const gate = checkLoginAllowed("2.2.2.2", "other");
    expect(gate.blocked).toBe(true);
  });

  it("clearLoginFailures réautorise après succès", () => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.THRESHOLD; i++) {
      recordLoginFailure("3.3.3.3", "demo");
    }
    expect(checkLoginAllowed("3.3.3.3", "demo").blocked).toBe(true);
    clearLoginFailures("3.3.3.3", "demo");
    expect(checkLoginAllowed("3.3.3.3", "demo").blocked).toBe(false);
  });

  it("augmente le cooldown avec les échecs suivants", () => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.THRESHOLD; i++) {
      recordLoginFailure("4.4.4.4", "admin");
    }
    const b1 = __peekLoginBucketForTests("id", "admin");
    const lock1 = b1?.lockedUntil ?? 0;
    recordLoginFailure("4.4.4.4", "admin");
    const b2 = __peekLoginBucketForTests("id", "admin");
    const lock2 = b2?.lockedUntil ?? 0;
    expect(lock2).toBeGreaterThanOrEqual(lock1);
  });

  it("expose des messages génériques", () => {
    expect(GENERIC_LOGIN_ERROR.toLowerCase()).not.toMatch(/existe|inconnu|email/);
    expect(rateLimitLoginMessage(30)).toMatch(/tentatives/i);
  });
});

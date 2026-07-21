import { describe, expect, it, afterEach, vi } from "vitest";
import { resolveAuthTrustHost } from "@/app/lib/auth/trust-host";

describe("resolveAuthTrustHost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("respecte AUTH_TRUST_HOST=false même sans AUTH_URL", () => {
    vi.stubEnv("AUTH_TRUST_HOST", "false");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    expect(resolveAuthTrustHost()).toBe(false);
  });

  it("respecte AUTH_TRUST_HOST=true", () => {
    vi.stubEnv("AUTH_TRUST_HOST", "true");
    vi.stubEnv("AUTH_URL", "https://example.com");
    expect(resolveAuthTrustHost()).toBe(true);
  });

  it("désactive trustHost si AUTH_URL est défini", () => {
    vi.stubEnv("AUTH_TRUST_HOST", "");
    vi.stubEnv("AUTH_URL", "https://patrimo-psi.vercel.app");
    vi.stubEnv("VERCEL", "1");
    expect(resolveAuthTrustHost()).toBe(false);
  });

  it("active trustHost sur Vercel preview sans AUTH_URL", () => {
    vi.stubEnv("AUTH_TRUST_HOST", "");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL", "1");
    expect(resolveAuthTrustHost()).toBe(true);
  });

  it("active trustHost en développement local hors production", () => {
    vi.stubEnv("AUTH_TRUST_HOST", "");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL", "");
    // NODE_ENV test runner = 'test' ≠ production → true
    expect(resolveAuthTrustHost()).toBe(true);
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getDeployBlockingConfigIssues,
  getRuntimeEnvStatus,
  timingSafeEqualSecret,
} from "@/app/lib/env/runtime";

describe("runtime env readiness", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  beforeEach(() => {
    delete process.env.VERCEL;
    delete process.env.PATRIMO_DEPLOYED;
    (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  });

  it("does not block local development without AUTH_SECRET", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.DATABASE_URL;
    expect(getDeployBlockingConfigIssues()).toEqual([]);
  });

  it("flags missing AUTH_SECRET when deployed-like", () => {
    process.env.VERCEL = "1";
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://x";
    delete process.env.AUTH_SECRET;
    process.env.ALLOW_DEMO_FALLBACK = "false";
    const issues = getDeployBlockingConfigIssues();
    expect(issues.some((i) => i.includes("AUTH_SECRET"))).toBe(true);
  });

  it("timingSafeEqualSecret rejects empty env secret", () => {
    delete process.env.CRON_SECRET;
    expect(timingSafeEqualSecret("anything", "CRON_SECRET")).toBe(false);
  });

  it("timingSafeEqualSecret accepts matching secret", () => {
    process.env.CRON_SECRET = "test-cron-secret-ok";
    expect(timingSafeEqualSecret("test-cron-secret-ok", "CRON_SECRET")).toBe(
      true
    );
    expect(timingSafeEqualSecret("wrong", "CRON_SECRET")).toBe(false);
  });

  it("reports authSecretConfigured by length", () => {
    process.env.AUTH_SECRET = "short";
    expect(getRuntimeEnvStatus().authSecretConfigured).toBe(false);
    process.env.AUTH_SECRET = "long-enough-secret!!";
    expect(getRuntimeEnvStatus().authSecretConfigured).toBe(true);
  });
});

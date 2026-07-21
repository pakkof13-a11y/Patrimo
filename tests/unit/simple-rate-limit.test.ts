import { describe, expect, it, beforeEach } from "vitest";
import {
  consumeRateLimit,
  __resetSimpleRateLimitForTests,
} from "@/app/lib/api/simple-rate-limit";

describe("simple rate limit (async + memory backend)", () => {
  beforeEach(() => {
    __resetSimpleRateLimitForTests();
  });

  it("autorise jusqu’à la limite", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await consumeRateLimit("t:a", 3, 60_000);
      expect(r.ok).toBe(true);
    }
    const blocked = await consumeRateLimit("t:a", 3, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("isole les clés", async () => {
    await consumeRateLimit("t:b1", 1, 60_000);
    const other = await consumeRateLimit("t:b2", 1, 60_000);
    expect(other.ok).toBe(true);
  });
});

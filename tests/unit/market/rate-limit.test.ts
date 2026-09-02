import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  FINNHUB_REST_LIMIT_PER_MINUTE,
} from "@/app/lib/market/rate-limit";

/**
 * Horloge simulée : `sleep` fait avancer le temps au lieu d'attendre. Les tests
 * vérifient donc une fenêtre d'une minute en quelques millisecondes, sans
 * dépendre du vrai `setTimeout` ni de faux temporisateurs globaux.
 */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    at: () => t,
  };
}

describe("createRateLimiter — admission immédiate", () => {
  it("admet jusqu'à la limite sans attendre", () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, ...clock });
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(false);
    expect(rl.used()).toBe(3);
    expect(rl.available()).toBe(0);
  });

  it("libère les jetons au fil de la fenêtre glissante, pas d'un bloc", () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, ...clock });
    rl.tryAcquire(); // t=0
    clock.advance(400);
    rl.tryAcquire(); // t=400
    clock.advance(400);
    rl.tryAcquire(); // t=800
    expect(rl.available()).toBe(0);

    // t=1001 : seul le tout premier appel est sorti de la fenêtre
    clock.advance(201);
    expect(rl.available()).toBe(1);

    // t=1401 : le deuxième sort à son tour
    clock.advance(400);
    expect(rl.available()).toBe(2);
  });

  it("ne compte plus rien une fois la fenêtre entièrement écoulée", () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, ...clock });
    rl.tryAcquire();
    rl.tryAcquire();
    clock.advance(1001);
    expect(rl.used()).toBe(0);
    expect(rl.tryAcquire()).toBe(true);
  });
});

describe("createRateLimiter — acquisitions concurrentes", () => {
  it("étale les appels au lieu de tous les admettre d'un coup", async () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, ...clock });
    const admittedAt: number[] = [];

    await Promise.all(
      Array.from({ length: 6 }, () =>
        rl.acquire().then(() => {
          admittedAt.push(clock.at());
        })
      )
    );

    expect(admittedAt).toHaveLength(6);
    // 2 par fenêtre de 1000 ms : trois vagues, jamais plus de 2 au même instant.
    for (const t of admittedAt) {
      const inSameWindow = admittedAt.filter((x) => Math.abs(x - t) < 1000);
      expect(inSameWindow.length).toBeLessThanOrEqual(2);
    }
  });

  it("ne dépasse jamais la limite sur une fenêtre glissante", async () => {
    const clock = fakeClock();
    const limit = 5;
    const rl = createRateLimiter({ limit, windowMs: 1000, ...clock });
    const admittedAt: number[] = [];

    await Promise.all(
      Array.from({ length: 23 }, () =>
        rl.acquire().then(() => admittedAt.push(clock.at()))
      )
    );

    // Pour chaque instant d'admission, compter les admissions dans la minute
    // glissante qui s'y termine.
    for (const t of admittedAt) {
      const within = admittedAt.filter((x) => x > t - 1000 && x <= t);
      expect(within.length).toBeLessThanOrEqual(limit);
    }
  });

  it("respecte l'ordre d'arrivée", async () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ limit: 1, windowMs: 100, ...clock });
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3].map((i) => rl.acquire().then(() => order.push(i)))
    );
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("ne bloque pas la file quand une acquisition est abandonnée", async () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ limit: 1, windowMs: 50, ...clock });
    // Une première acquisition dont on ignore le résultat
    void rl.acquire();
    // La suivante doit tout de même aboutir
    await expect(rl.acquire()).resolves.toBeUndefined();
  });
});

describe("createRateLimiter — garde-fous", () => {
  it("refuse une configuration absurde", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => createRateLimiter({ limit: 5, windowMs: 0 })).toThrow();
  });

  it("repart à zéro après reset", () => {
    const clock = fakeClock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, ...clock });
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(false);
    rl.reset();
    expect(rl.tryAcquire()).toBe(true);
  });
});

describe("budget Finnhub", () => {
  it("garde une marge sous les 60 appels/minute du free tier", () => {
    expect(FINNHUB_REST_LIMIT_PER_MINUTE).toBeLessThan(60);
    expect(FINNHUB_REST_LIMIT_PER_MINUTE).toBeGreaterThanOrEqual(50);
  });
});

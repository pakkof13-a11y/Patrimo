/**
 * Multi-tenant Prisma helpers — never mutate a row by bare `id` alone.
 *
 * Pattern for sensitive writes:
 *   where: owned(id, userId)
 *   updateMany / deleteMany → then re-fetch if a full row is needed.
 */

/** Composite ownership filter for models with `{ id, userId }`. */
export function owned(id: string, userId: string) {
  return { id, userId } as const;
}

/** True when a write affected at least one row belonging to the user. */
export function wroteOne(result: { count: number }): boolean {
  return result.count === 1;
}

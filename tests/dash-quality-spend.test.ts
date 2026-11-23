import { describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/core/supabase-admin', () => ({ createCoreServiceSupabase: () => null }));

const { dashQualityPorts } = await import('@/inngest/core/dash-quality');

/** A query builder that records each filter and answers with no rows. */
function recordingClient() {
  const filters: { table: string; method: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'not', 'is']) {
        builder[method] = (...args: unknown[]) => {
          filters.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
      return builder;
    },
  };
  return { client, filters };
}

describe("the health run's spend read", () => {
  it('reads the spend of thread and goal replies as well as Ask', async () => {
    const { client, filters } = recordingClient();
    const ports = dashQualityPorts(client as never);
    await ports.spend('user-1', '2026-11-22T07:17:00Z');
    const operation = filters.find((f) => f.table === 'model_spend' && f.args[0] === 'operation');
    expect(operation?.method).toBe('in');
    expect(operation?.args[1]).toEqual(['ask-dash', 'reply-to-comment', 'reply-to-goal-comment']);
  });
});

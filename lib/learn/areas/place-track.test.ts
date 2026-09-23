import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeTrack } from './place-track';

/**
 * Placing one track. The model path is `placeTracks`, tested with the other
 * callers in place.test.ts; what is checked here is the copy from a theme,
 * which makes no call, and that a failure is reported rather than thrown.
 */

type Update = { columns: Record<string, unknown>; id: unknown; unplacedOnly: boolean };

function client(themeRow: Record<string, unknown> | null) {
  const updates: Update[] = [];
  const stub = {
    from(table: string) {
      if (table === 'theme_fields') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: themeRow, error: null }) }),
          }),
        };
      }
      return {
        update: (columns: Record<string, unknown>) => ({
          eq: (_column: string, id: unknown) => ({
            is: async (column: string, value: unknown) => {
              updates.push({ columns, id, unplacedOnly: column === 'placed_at' && value === null });
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return { client: stub as never, updates };
}

const TRACK = { id: 'subject-1', name: 'Urban design', context: 'aimed at: how streets shape travel' };

describe('placing a track', () => {
  const key = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = key;
  });

  it("copies the theme's placement when the track was started from one", async () => {
    const { client: supabase, updates } = client({
      field_id: 'field-urban',
      domain_id: null,
      runner_up_id: 'field-transport',
      confidence: 'close',
      basis: 'Street layout is studied in urban planning.',
      model: 'claude-opus-5',
    });

    const outcome = await placeTrack(supabase, 'user-1', TRACK, { id: 'theme-1', about: 'Streets.' });

    expect(outcome).toBe('copied');
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('subject-1');
    expect(updates[0].unplacedOnly).toBe(true);
    expect(updates[0].columns).toMatchObject({
      field_id: 'field-urban',
      domain_id: null,
      runner_up_field_id: 'field-transport',
      placement_confidence: 'close',
      placement_basis: 'Street layout is studied in urban planning.',
      placement_model: 'claude-opus-5',
    });
    expect(updates[0].columns.placed_at).toEqual(expect.any(String));
  });

  it('reports a failure without throwing when there is nothing to copy and no key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { client: supabase, updates } = client(null);
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await placeTrack(supabase, 'user-1', TRACK, { id: 'theme-1', about: 'Streets.' });

    expect(outcome).toBe('failed');
    expect(updates).toHaveLength(0);
    onError.mockRestore();
  });
});

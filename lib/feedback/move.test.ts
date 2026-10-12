import { describe, expect, it } from 'vitest';
import {
  ideaModule,
  moveIdeaToNote,
  moveNoteToIdea,
  movedResolution,
  routesToPlan,
} from '@/lib/feedback/move';
import type { Triage } from '@/lib/feedback/triage';

const at = '2026-10-11T00:00:00Z';
const triage = (over: Partial<Triage>): Triage => ({
  at,
  kind: null,
  module: null,
  priority: null,
  route: null,
  duplicate: null,
  ...over,
});

describe('routesToPlan', () => {
  it('moves only a sure plan answer', () => {
    expect(routesToPlan(triage({ route: { value: 'plan', confidence: 0.9 } }))).toBe(true);
    expect(routesToPlan(triage({ route: { value: 'plan', confidence: 0.6 } }))).toBe(false);
    expect(routesToPlan(triage({ route: { value: 'fix', confidence: 0.95 } }))).toBe(false);
    expect(routesToPlan(triage({}))).toBe(false);
    expect(routesToPlan(null)).toBe(false);
  });
});

describe('ideaModule', () => {
  it('takes the triaged workspace, and the whole app as none', () => {
    expect(ideaModule(triage({ module: { value: 'dev', confidence: 0.9 } }))).toBe('dev');
    expect(ideaModule(triage({ module: { value: 'app', confidence: 0.9 } }))).toBeNull();
    expect(ideaModule(null)).toBeNull();
  });
});

describe('movedResolution', () => {
  it('names the idea by its first line', () => {
    expect(movedResolution('A weekly digest\nwith more')).toBe(
      'Moved to the ideas page as the idea “A weekly digest”.',
    );
  });
});

/** A client that answers each read from `rows` and records every write. */
function fakeClient(rows: Record<string, Record<string, unknown> | null>) {
  const writes: Array<{ table: string; op: string; values: unknown; filters: string[] }> = [];
  return {
    writes,
    from(table: string) {
      let op = 'select';
      let values: unknown = null;
      const filters: string[] = [];
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      builder.select = self;
      builder.insert = (v: unknown) => ((op = 'insert'), (values = v), builder);
      builder.update = (v: unknown) => ((op = 'update'), (values = v), builder);
      builder.eq = (column: string, value: unknown) => (filters.push(`${column}=${value}`), builder);
      const answer = () => {
        if (op !== 'select') writes.push({ table, op, values, filters });
        if (op === 'insert') return { data: { id: 'new-idea' }, error: null };
        if (op === 'update' && table === 'ideas') return { data: rows['ideas:update'] ?? null, error: null };
        if (op === 'update') return { data: null, error: null };
        return { data: rows[table] ?? null, error: null };
      };
      builder.single = async () => answer();
      builder.maybeSingle = async () => answer();
      builder.then = (resolve: (v: unknown) => unknown) => resolve(answer());
      return builder;
    },
  };
}

describe('moveNoteToIdea', () => {
  it('writes an idea from the note with its workspace and marks the note planned', async () => {
    const client = fakeClient({
      feedback_items: {
        body: 'Plan a weekly review',
        triage: triage({ module: { value: 'goals', confidence: 0.9 } }),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await moveNoteToIdea(client as any, { userId: 'u', noteId: 'n' });
    expect(result).toEqual({ ok: true, ideaId: 'new-idea' });
    expect(client.writes[0]).toMatchObject({
      table: 'ideas',
      op: 'insert',
      values: { user_id: 'u', body: 'Plan a weekly review', module: 'goals', source: 'me' },
    });
    expect(client.writes[1]).toMatchObject({
      table: 'feedback_items',
      op: 'update',
      values: { status: 'planned', resolution_note: movedResolution('Plan a weekly review') },
    });
  });

  it('restores the idea an earlier flip dismissed rather than writing another', async () => {
    const client = fakeClient({
      feedback_items: { body: 'x y z', triage: null },
      'ideas:update': { id: 'old-idea' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await moveNoteToIdea(client as any, { userId: 'u', noteId: 'n', ideaId: 'old-idea' });
    expect(result).toEqual({ ok: true, ideaId: 'old-idea' });
    expect(client.writes.map((w) => `${w.table}:${w.op}`)).toEqual([
      'ideas:update',
      'feedback_items:update',
    ]);
  });
});

describe('moveIdeaToNote', () => {
  it('reopens the note and dismisses the idea', async () => {
    const client = fakeClient({ ideas: { id: 'i', plan_item_id: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await moveIdeaToNote(client as any, { userId: 'u', noteId: 'n', ideaId: 'i' });
    expect(result).toEqual({ ok: true, ideaId: 'i' });
    expect(client.writes[0]).toMatchObject({
      table: 'feedback_items',
      values: { status: 'open', resolution_note: null },
    });
    expect(client.writes[1].table).toBe('ideas');
    expect(client.writes[1].values).toHaveProperty('dismissed_at');
  });

  it('refuses once the idea is in the plan', async () => {
    const client = fakeClient({ ideas: { id: 'i', plan_item_id: 'p' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await moveIdeaToNote(client as any, { userId: 'u', noteId: 'n', ideaId: 'i' });
    expect(result.ok).toBe(false);
    expect(client.writes).toEqual([]);
  });
});

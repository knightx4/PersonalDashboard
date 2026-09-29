/**
 * The morning run against the plan as it stood on 29 September (plan #1222).
 *
 * That morning it filed "Steps blocked on code that shipped four days ago are
 * clear to move (#985, #986, #1001)" and a fifth "#1048 is still open", when
 * all four rows had closed. The model is stubbed to say exactly that again;
 * what is checked is what the run does with it, and what it showed the model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DigestContext, DigestReading } from '@/inngest/dev/suggest';
import {
  MORNING_REPEATS,
  ROWS_ON_29_SEPTEMBER,
  asSuggestion,
} from '@/lib/ideas/fixtures/morning-repeats';

const reading = vi.hoisted(() => ({
  next: { summary: null, suggestions: [] } as DigestReading,
  context: null as DigestContext | null,
}));

vi.mock('@/inngest/dev/suggest', () => ({
  suggestForDigest: async (input: { context: DigestContext }) => {
    reading.context = input.context;
    return reading.next;
  },
}));

const { writeDigestFor } = await import('@/inngest/dev/digest');

type Row = Record<string, unknown>;

/** The query builder, far enough for the reads and the idea inserts this makes. */
function stubClient(tables: Record<string, Row[]>) {
  const inserted: Array<{ table: string; row: Row }> = [];

  const builder = (table: string) => {
    const rows = () => tables[table] ?? [];
    const self = {
      select: () => self,
      eq: () => self,
      in: () => self,
      is: () => self,
      order: () => self,
      range: () => self,
      limit: () => self,
      maybeSingle: async () => ({
        data: table === 'dev_digests' ? null : (rows()[0] ?? null),
        error: null,
      }),
      insert: (row: Row) => {
        inserted.push({ table, row });
        const written = { id: `new-${inserted.length}`, ...row };
        (tables[table] ??= []).push(written);
        const result = { error: null };
        return {
          select: () => ({ single: async () => ({ data: written, error: null }) }),
          then: (resolve: (value: typeof result) => unknown) => resolve(result),
        };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
    };
    return self;
  };

  return { supabase: { from: builder } as unknown as SupabaseClient, inserted };
}

const NOW = new Date('2026-09-29T12:34:00Z');

function planRow(over: Row): Row {
  return {
    id: `p${String(over.number)}`,
    module: 'dev',
    parent_id: null,
    title: `Row ${String(over.number)}`,
    detail: null,
    acceptance: null,
    status: 'done',
    kind: 'build',
    fog: null,
    resolution: null,
    comment: null,
    priority: 2,
    size: null,
    assignee: null,
    commit_sha: null,
    position: 10,
    started_at: null,
    completed_at: '2026-09-25T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    dismissed_at: null,
    ...over,
  };
}

/** The plan on the 29th, plus one step still blocked. */
function september29(): Row[] {
  return [
    ...ROWS_ON_29_SEPTEMBER.map((row) =>
      planRow({
        number: row.number,
        kind: row.kind,
        status: row.status,
        completed_at: row.completedAt,
      }),
    ),
    planRow({
      number: 1100,
      title: 'Read statements from Gmail',
      status: 'blocked',
      completed_at: null,
      comment: 'Waits on #985 shipping.',
    }),
  ];
}

function idea(over: Row): Row {
  return {
    module: null,
    created_at: '2026-09-27T12:34:00Z',
    source: 'claude',
    dismissed_at: null,
    triage: null,
    plan_item: null,
    from_plan_item: null,
    thread: [],
    ...over,
  };
}

function suggestion(id: string) {
  const row = MORNING_REPEATS.find((repeat) => repeat.id === id);
  if (!row) throw new Error(`no fixture ${id}`);
  return asSuggestion(row);
}

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  reading.context = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('writeDigestFor on 29 September', () => {
  it('files neither observation about closed rows, and files one naming an open row', async () => {
    const open = { title: 'A step blocked for a week (#1100)', detail: 'Read its block.' };
    reading.next = {
      summary: null,
      suggestions: [suggestion('1e5937f9'), suggestion('d6d28a49'), open],
    };
    const { supabase, inserted } = stubClient({ plan_items: september29() });

    await writeDigestFor(supabase, 'user-1', NOW);

    const ideas = inserted.filter((row) => row.table === 'ideas');
    expect(ideas.map((row) => row.row.body)).toEqual([
      'A step blocked for a week (#1100)\n\nRead its block.',
    ]);

    const digest = inserted.find((row) => row.table === 'dev_digests')?.row;
    expect(digest?.ideas_filed).toBe(1);
    const noticed = (digest?.attention as Array<{ kind: string; title: string }>).filter(
      (pointer) => pointer.kind === 'suggestion',
    );
    expect(noticed.map((pointer) => pointer.title)).toEqual(['A step blocked for a week (#1100)']);
  });

  it('shows the model each row’s status and leaves out its own earlier lines', async () => {
    reading.next = { summary: null, suggestions: [] };
    const { supabase } = stubClient({
      plan_items: september29(),
      ideas: [
        idea({ id: 'i1', body: MORNING_REPEATS[1].body }),
        idea({
          id: 'i2',
          body: 'Follow on from the import (#1048)',
          from_plan_item: { number: 669, title: 'x' },
        }),
        idea({ id: 'i3', body: 'A thought of mine about #1100', source: 'me' }),
      ],
    });

    await writeDigestFor(supabase, 'user-1', NOW);

    const context = reading.context as DigestContext;
    expect(context.unshapedIdeas).toHaveLength(2);
    expect(context.unshapedIdeas.join('\n')).not.toContain('clear to move');
    expect(context.unshapedIdeas.join('\n')).toContain('#1100 (blocked)');
    expect(context.unshapedIdeas.join('\n')).toContain('#1048 (answered)');
    expect(context.blockedSteps[0]).toContain('#985 (done)');
  });
});

describe('writeDigestFor with a block the run thinks is stale (#1224)', () => {
  const staleBlock = {
    title: 'Gmail statements look clear to move (#1100)',
    detail: 'What it waited on has shipped.',
    step: 1100,
    kind: 'stale_block' as const,
  };

  it('writes one waiting check-back on the blocked step and no idea', async () => {
    reading.next = { summary: null, suggestions: [staleBlock] };
    const { supabase, inserted } = stubClient({ plan_items: september29() });

    await writeDigestFor(supabase, 'user-1', NOW);

    expect(inserted.filter((row) => row.table === 'ideas')).toEqual([]);
    const checkBacks = inserted.filter((row) => row.table === 'check_backs');
    expect(checkBacks).toHaveLength(1);
    expect(checkBacks[0]!.row).toMatchObject({
      user_id: 'user-1',
      plan_item_id: 'p1100',
      due_at: NOW.toISOString(),
      wake: true,
      source: 'morning run',
    });
    expect(inserted.find((row) => row.table === 'dev_digests')?.row.ideas_filed).toBe(0);
  });

  it('writes nothing new the next morning while that check-back is waiting', async () => {
    reading.next = { summary: null, suggestions: [staleBlock] };
    const { supabase, inserted } = stubClient({
      plan_items: september29(),
      check_backs: [{ plan_item_id: 'p1100', status: 'waiting' }],
    });

    await writeDigestFor(supabase, 'user-1', new Date('2026-09-30T12:34:00Z'));

    expect(inserted.filter((row) => row.table === 'check_backs')).toEqual([]);
    expect(inserted.filter((row) => row.table === 'ideas')).toEqual([]);
  });

  it('files a stale-block suggestion about a step that is not blocked as an idea, as before', async () => {
    reading.next = {
      summary: null,
      suggestions: [{ ...staleBlock, title: 'Gmail statements look clear to move (#1101)', step: 1101 }],
    };
    const rows = [
      ...september29(),
      planRow({ number: 1101, status: 'not_started', completed_at: null }),
    ];
    const { supabase, inserted } = stubClient({ plan_items: rows });

    await writeDigestFor(supabase, 'user-1', NOW);

    expect(inserted.filter((row) => row.table === 'check_backs')).toEqual([]);
    expect(inserted.filter((row) => row.table === 'ideas').map((row) => row.row.body)).toEqual([
      'Gmail statements look clear to move (#1101)\n\nWhat it waited on has shipped.',
    ]);
  });
});

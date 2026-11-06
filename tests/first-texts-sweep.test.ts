/**
 * People text first (plan #2854.1): the pass that turns what happened on the
 * plan into one text from the person whose rule covers it, and the
 * migration that writes what happened.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FirstTextPorts, RulePerson, StoredEvent } from '@/inngest/you/first-texts';
import { SETTLE_MS, STALE_MS } from '@/lib/you/first-texts';

vi.mock('server-only', () => ({}));

const { runFirstTextsWith } = await import('@/inngest/you/first-texts');

// 10:00 in New York.
const NOW = new Date('2026-11-04T15:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const BUILDER: RulePerson = { id: 'a1', userId: 'u1', key: 'builder', name: 'Builder', textWhen: null };

function event(id: string, fields: Partial<StoredEvent> = {}): StoredEvent {
  return { id, kind: 'shipped', createdAt: ago(SETTLE_MS + 1_000), planItemId: `item-${id}`, detail: null, ...fields };
}

function ports(events: StoredEvent[], over: Partial<FirstTextPorts> = {}): FirstTextPorts & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    people: async () => [BUILDER],
    open: async () => events,
    steps: async (_u: string, ids: readonly string[]) => new Map(ids.map((id: string) => [id, { ref: `#2854.${id.slice(5)}`, title: `Step ${id.slice(5)}` }])),
    timezone: async () => 'America/New_York',
    sentSince: async () => 0,
    send: vi.fn(async () => 'msg-1'),
    close: vi.fn(async () => {}),
    closeStale: async () => 0,
    ...over,
  } as never;
}

describe('one pass of the first texts', () => {
  it('sends one text for everything since the last, and closes what it covers', async () => {
    const p = ports([event('1'), event('2'), event('3', { kind: 'needs_you' })]);
    const summary = await runFirstTextsWith(p, NOW);
    expect(p.send).toHaveBeenCalledTimes(1);
    const sent = p.send.mock.calls[0][0];
    expect(sent.person).toBe(BUILDER);
    expect(sent.bubbles).toEqual(['#2854.3 needs you: Step 3.', 'Shipped 2: #2854.1 (Step 1) and #2854.2 (Step 2).']);
    expect(sent.push).toBe(true);
    expect(p.close).toHaveBeenCalledWith('u1', ['1', '2', '3'], 'msg-1', NOW);
    expect(summary.sent).toEqual([{ userId: 'u1', rule: 'builder', events: 3, push: true }]);
  });

  it('sends nothing while changes are still arriving', async () => {
    const p = ports([event('1', { createdAt: ago(30_000) })]);
    const summary = await runFirstTextsWith(p, NOW);
    expect(p.send).not.toHaveBeenCalled();
    expect(summary.waiting).toEqual([{ userId: 'u1', rule: 'builder', reason: 'settling' }]);
  });

  it('keeps to what the person switched on, closing the rest unsent', async () => {
    const p = ports([event('1'), event('2', { kind: 'failed', detail: 'stalled' })], {
      people: async () => [{ ...BUILDER, textWhen: ['failed'] }],
    });
    await runFirstTextsWith(p, NOW);
    expect(p.close).toHaveBeenCalledWith('u1', ['1'], null, NOW);
    expect(p.send.mock.calls[0][0].bubbles).toEqual(['The build of #2854.2 stalled.']);
    // Every text first reaches the phone, a stalled build too (note 6a69a1c3).
    expect(p.send.mock.calls[0][0].push).toBe(true);
  });

  it('does nothing for someone with no rule, and closes stale events everywhere', async () => {
    const closeStale = vi.fn(async () => 2);
    const p = ports([event('1')], { people: async () => [{ ...BUILDER, key: 'cfo' }], closeStale });
    const summary = await runFirstTextsWith(p, NOW);
    expect(p.send).not.toHaveBeenCalled();
    expect(closeStale).toHaveBeenCalledWith(new Date(NOW.getTime() - STALE_MS));
    expect(summary.closed).toBe(2);
  });

  it('records a failure for one person and goes on', async () => {
    const p = ports([event('1')], { send: vi.fn(async () => Promise.reject(new Error('insert refused'))) as never });
    const summary = await runFirstTextsWith(p, NOW);
    expect(summary.failed).toEqual(['insert refused']);
  });
});

describe('the migration', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations-you/0042_first_texts.sql'), 'utf8');

  it('writes an event from the plan and from its build runs', () => {
    expect(sql).toMatch(/create trigger plan_items_text_event\s+after insert or update of status on public\.plan_items/);
    expect(sql).toMatch(/create trigger plan_runs_text_event\s+after insert or update of status on public\.plan_runs/);
    expect(sql).toContain("new.job not in ('step', 'feature', 'queue')");
  });

  it('keeps the Council caps on the Council texts alone', () => {
    expect(sql.match(/m\.text_rule is null/g)?.length).toBe(3);
  });
});

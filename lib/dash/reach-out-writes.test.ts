import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { planUndo } from '@/lib/core/dash-actions';

vi.mock('server-only', () => ({}));

const make = vi.fn();
vi.mock('@/lib/you/reach-out-make', async (original) => ({
  ...(await original<typeof import('@/lib/you/reach-out-make')>()),
  makeReachOutRule: (...args: unknown[]) => make(...args),
}));

const draft = vi.fn();
vi.mock('@/lib/you/advisor-watch', async (original) => ({
  ...(await original<typeof import('@/lib/you/advisor-watch')>()),
  draftAdvisorWatch: (...args: unknown[]) => draft(...args),
}));

const { runYouWrite, YOU_WRITES } = await import('./you-writes');

/** set_reach_out (plan #2931.4): a sentence becomes the person's rule, saved as the form saves it. */

const ME = '00000000-0000-4000-8000-0000000000aa';
const HM = '11111111-1111-4111-8111-111111111111';
const tool = YOU_WRITES.find((entry) => entry.name === 'set_reach_out')!;

const RULE = { cadence: 'weekly' };
const OLD_RULE = { cadence: 'daily' };

function tables(): FakeTables {
  return {
    'you.board_advisors': [
      { id: HM, user_id: ME, key: 'hiring_manager', name: 'The Hiring Manager', reach_out_brief: 'old words', reach_out_rule: OLD_RULE, reach_out_summary: 'Old.' },
      { id: 'b', user_id: ME, key: 'seneca', name: 'Seneca', reach_out_brief: null, reach_out_rule: null, reach_out_summary: null },
      { id: 'c', user_id: 'someone-else', key: 'hiring_manager', name: 'The Hiring Manager', reach_out_brief: null },
    ],
  };
}
const env = (t: FakeTables, rules: object = { client: {} }) => ({
  userId: ME,
  you: fakeSchemaDb(t)('you'),
  rules,
});
const rowOf = (t: FakeTables, id: string) => t['you.board_advisors'].find((r) => r.id === id)!;

beforeEach(() => {
  draft.mockReset();
  make.mockReset();
  make.mockResolvedValue({ ok: true, rule: RULE, summary: 'The Hiring Manager will text you every Monday about good-fit jobs.' });
});

describe('set_reach_out', () => {
  it('makes the rule from the sentence, saves it with the summary and says it back', async () => {
    const t = tables();
    const result = await runYouWrite(tool, env(t), { person: 'hiring manager', brief: 'good-fit jobs every Monday' });
    if ('ok' in result) throw new Error(result.error);
    expect(make).toHaveBeenCalledWith({ name: 'The Hiring Manager', brief: 'good-fit jobs every Monday' }, expect.anything());
    expect(rowOf(t, HM)).toMatchObject({ reach_out_brief: 'good-fit jobs every Monday', reach_out_rule: RULE, reach_out_error: null });
    expect(result).toMatchObject({ kind: 'set_reach_out', op: 'update', subjectRef: `you.board_advisors:${HM}` });
    expect(result.summary).toContain('every Monday about good-fit jobs');
    expect(result.before).toMatchObject({ reach_out_brief: 'old words', reach_out_rule: OLD_RULE });
    expect(result.after).toMatchObject({ reach_out_rule: RULE });
  });

  it('leaves the other account and the other people alone', async () => {
    const t = tables();
    await runYouWrite(tool, env(t), { person: 'The Hiring Manager', brief: 'jobs' });
    expect(rowOf(t, 'c').reach_out_brief).toBeNull();
    expect(rowOf(t, 'b').reach_out_brief).toBeNull();
  });

  it('keeps what was there when the rule cannot be made', async () => {
    make.mockResolvedValue({ ok: false, error: 'Dash could not read that.' });
    const t = tables();
    const result = await runYouWrite(tool, env(t), { person: 'the hiring manager', brief: 'x' });
    expect(result).toMatchObject({ ok: false });
    expect(rowOf(t, HM).reach_out_brief).toBe('old words');
  });

  it('refuses a person who is not on People, and one that matches two', async () => {
    const t = tables();
    expect(await runYouWrite(tool, env(t), { person: 'Nobody', brief: 'x' })).toMatchObject({ ok: false });
    t['you.board_advisors'].push({ id: 'd', user_id: ME, key: 'hiring_lead', name: 'The Hiring Lead' });
    const two = await runYouWrite(tool, env(t), { person: 'Hiring', brief: 'x' });
    expect(two).toMatchObject({ ok: false });
    expect((two as { error: string }).error).toContain('More than one');
    expect(make).not.toHaveBeenCalled();
  });

  it('refuses where no key is set, without a call', async () => {
    const result = await runYouWrite(tool, env(tables(), {}), { person: 'Seneca', brief: 'x' });
    expect(result).toMatchObject({ ok: false });
    expect(make).not.toHaveBeenCalled();
  });

  it('clears the rule on an empty brief with no call', async () => {
    const t = tables();
    const result = await runYouWrite(tool, env(t), { person: 'Hiring Manager', brief: '' });
    if ('ok' in result) throw new Error(result.error);
    expect(make).not.toHaveBeenCalled();
    expect(rowOf(t, HM)).toMatchObject({ reach_out_brief: null, reach_out_rule: null });
  });

  it('can be undone by putting the earlier brief and rule back', async () => {
    const t = tables();
    const result = await runYouWrite(tool, env(t), { person: 'the hiring manager', brief: 'new' });
    if ('ok' in result) throw new Error(result.error);
    const action = {
      status: 'done',
      surface: 'ask',
      kind: 'set_reach_out',
      op: 'update',
      subjectRef: result.subjectRef,
      beforeValues: result.before,
      afterValues: result.after,
      undo: null,
    } as never;
    const plan = planUndo(action, rowOf(t, HM) as never, false, true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.plan).toMatchObject({ op: 'update', values: { reach_out_brief: 'old words', reach_out_rule: OLD_RULE } });
  });

  describe('a brief no fixed watch covers (plan #3030.1.1)', () => {
    const ASK = { userId: ME } as never;
    const SISTER = {
      ok: true,
      matched: 2,
      draft: {
        key: 'custom_sister_ab12cd',
        about: 'Vault notes that mention Anna',
        sendsWhen: 'A note in your vault mentions Anna.',
        sample: 'Your note "Sunday call" mentions Anna.',
        everyDays: 1,
        mode: 'each',
        query: { table: 'obsidian.notes', where: [{ column: 'body', op: 'contains', value: 'Anna' }], limit: 50 },
        tables: ['obsidian.notes'],
      },
    };
    const withWatches = () => ({ ...tables(), 'you.advisor_watches': [] as Record<string, unknown>[] });

    beforeEach(() => {
      make.mockResolvedValue({ ok: false, uncovered: true, error: 'Dash cannot watch anything you asked for: notes that mention your sister.' });
      draft.mockResolvedValue(SISTER);
    });

    it('writes a proposed watch instead of refusing, and leaves the rule as it was', async () => {
      const t = withWatches();
      const result = await runYouWrite(tool, env(t, { client: {}, ask: ASK }), { person: 'Seneca', brief: 'tell me when a vault note mentions my sister' });
      if ('ok' in result) throw new Error(result.error);
      expect(draft).toHaveBeenCalledWith({ name: 'Seneca', brief: 'tell me when a vault note mentions my sister' }, expect.objectContaining({ ask: ASK }));
      const saved = t['you.advisor_watches'];
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ user_id: ME, advisor_id: 'b', status: 'proposed', key: 'custom_sister_ab12cd', tables: ['obsidian.notes'] });
      expect(saved[0].query).toEqual(SISTER.draft.query);
      expect(rowOf(t, 'b').reach_out_brief).toBeNull();
      expect(result).toMatchObject({ kind: 'set_reach_out', op: 'insert', before: null, subjectRef: `you.advisor_watches:${saved[0].id}` });
      expect(result.summary).toContain('Vault notes that mention Anna');
      expect(result.summary).toContain('every day');
      expect(result.summary).toContain('runs nothing until you approve it');
    });

    it('is undone by removing the proposal', async () => {
      const t = withWatches();
      const result = await runYouWrite(tool, env(t, { client: {}, ask: ASK }), { person: 'Seneca', brief: 'my sister' });
      if ('ok' in result) throw new Error(result.error);
      const action = { status: 'done', surface: 'ask', kind: 'set_reach_out', op: 'insert', subjectRef: result.subjectRef, beforeValues: null, afterValues: result.after, undo: null } as never;
      const plan = planUndo(action, t['you.advisor_watches'][0] as never, false, true);
      if (!plan.ok) throw new Error(plan.reason);
      expect(plan.plan).toEqual({ op: 'delete' });
    });

    it('says why and saves nothing when the watch cannot be written', async () => {
      draft.mockResolvedValue({ ok: false, error: 'Dash cannot watch that: nothing holds the weather.' });
      const t = withWatches();
      const result = await runYouWrite(tool, env(t, { client: {}, ask: ASK }), { person: 'Seneca', brief: 'the weather' });
      expect(result).toMatchObject({ ok: false });
      expect((result as { error: string }).error).toContain('nothing holds the weather');
      expect(t['you.advisor_watches']).toHaveLength(0);
    });

    it('refuses as before where no lookups are given', async () => {
      const t = withWatches();
      expect(await runYouWrite(tool, env(t), { person: 'Seneca', brief: 'my sister' })).toMatchObject({ ok: false });
      expect(draft).not.toHaveBeenCalled();
    });

    it('does not write a watch for any other refusal', async () => {
      make.mockResolvedValue({ ok: false, error: 'Dash is busy.' });
      const t = withWatches();
      expect(await runYouWrite(tool, env(t, { client: {}, ask: ASK }), { person: 'Seneca', brief: 'x' })).toMatchObject({ ok: false });
      expect(draft).not.toHaveBeenCalled();
    });
  });
});

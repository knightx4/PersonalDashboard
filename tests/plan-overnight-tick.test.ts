/**
 * The clock tick that keeps up to three features going a night, each in a
 * different module.
 *
 * The properties that matter are the ones about restraint: a tick with a
 * session still working must change nothing at all, a tick with the runner off
 * must not so much as read the plan, and a tick that does fire must fire once
 * and take exactly one off the budget. The fourth is the guard that stops a
 * feature whose remaining work is stuck being sent a session every few minutes
 * for the rest of the night. The fifth is the same restraint applied to the
 * send's own refusals: a feature it will not take costs the tick a candidate,
 * not the whole turn.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import { budgetSpentReason, OVERNIGHT_TIME_UP, type OvernightRun } from '@/lib/plan/overnight';
import { OVERNIGHT_NOTHING_READY } from '@/lib/plan/overnight-choice';
import {
  chooseOvernightFire,
  closedNothingSince,
  overnightRefusedReason,
  overnightTick,
  featureRunLiveness,
  featureRunsInFlight,
  OVERNIGHT_NO_PROGRESS,
  outsideRunning,
  runOvernightTick,
  tickNote,
  type OvernightPorts,
} from '@/inngest/dev/overnight';
import { buildPlanTree, findNode, type PlanSection } from '@/lib/plan/tree';

const MIDNIGHT = Date.parse('2026-09-17T23:00:00.000Z');
const SEVEN_AM = '2026-09-18T07:00:00.000Z';
const YESTERDAY = '2026-09-16T12:00:00.000Z';

let counter = 0;

function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'shopping',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    ...over,
  };
}

function tree(items: PlanItem[], dependencies: PlanDependency[] = []): PlanSection[] {
  return buildPlanTree({ items, dependencies });
}

function night(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'run-1',
    running: true,
    paused: false,
    featuresBudget: 6,
    featuresLeft: 6,
    stopBy: SEVEN_AM,
    startedAt: '2026-09-17T23:00:00.000Z',
    lastFiredAt: null,
    endedAt: null,
    endedReason: null,
    lastTickAt: null,
    lastTickNote: null,
    createdAt: '2026-09-17T23:00:00.000Z',
    updatedAt: '2026-09-17T23:00:00.000Z',
    ...over,
  };
}

/** One feature with one ready step under it, which is the ordinary case. */
const oneReadyFeature = () => [item({ id: 'feature' }), item({ id: 'step', parentId: 'feature' })];

/** Two features, the first by priority named first. */
const twoFeatures = () => [
  item({ id: 'first', priority: 1 }),
  item({ id: 'first-step', parentId: 'first', priority: 1 }),
  item({ id: 'second', priority: 3 }),
  item({ id: 'second-step', parentId: 'second', priority: 3 }),
];

/**
 * The ports, with every one of them recorded and nothing real behind any.
 *
 * The defaults are an ordinary night: one feature ready, nothing fired yet, so
 * there is no last run to wait for.
 */
function ports(over: Partial<OvernightPorts> = {}) {
  const calls = {
    sections: 0,
    swept: 0,
    /** What the tick asked for, in the order it asked, so sweep-then-tree can be checked. */
    order: [] as string[],
    fired: [] as Array<{ feature: string; step: string }>,
    recorded: [] as (number | null)[],
    stopped: [] as string[],
  };
  const sections = tree(oneReadyFeature());

  const base: OvernightPorts = {
    now: MIDNIGHT,
    loadRun: async () => night(),
    loadSections: async () => {
      calls.sections += 1;
      calls.order.push('sections');
      return sections;
    },
    lastFiredAt: async () => ({}),
    runsInFlight: async () => [],
    sweepClaims: async () => {
      calls.swept += 1;
      calls.order.push('sweep');
    },
    fire: async (feature, step) => {
      calls.fired.push({ feature: feature.id, step: step.id });
      return { ok: true };
    },
    recordFire: async (featuresLeft) => {
      calls.recorded.push(featuresLeft);
    },
    stop: async (reason) => {
      calls.stopped.push(reason);
    },
    ...over,
  };
  return { ports: base, calls };
}

describe('closedNothingSince', () => {
  const feature = () => {
    const sections = tree([
      item({ id: 'feature' }),
      item({ id: 'closed', parentId: 'feature', status: 'done', completedAt: MIDNIGHT_ISO(-30) }),
    ]);
    return findNode(sections, 'feature')!;
  };

  function MIDNIGHT_ISO(minutes: number): string {
    return new Date(MIDNIGHT + minutes * 60_000).toISOString();
  }

  it('is false when there was no run to judge', () => {
    expect(closedNothingSince(feature(), null)).toBe(false);
  });

  it('is false when a step closed after the run started', () => {
    expect(closedNothingSince(feature(), MIDNIGHT_ISO(-60))).toBe(false);
  });

  it('is true when everything under it closed before the run started', () => {
    expect(closedNothingSince(feature(), MIDNIGHT_ISO(-10))).toBe(true);
  });
});

describe('chooseOvernightFire', () => {
  it('fires the feature the chooser names when it has never been run', () => {
    const choice = chooseOvernightFire(tree(oneReadyFeature()), night(), MIDNIGHT, {});

    expect(choice).toMatchObject({ act: 'fire' });
    expect(choice.act === 'fire' && choice.feature.id).toBe('feature');
  });

  it('fires it again when its last run did close a step', () => {
    const sections = tree([
      item({ id: 'feature' }),
      item({ id: 'done-step', parentId: 'feature', status: 'done', completedAt: SEVEN_AM }),
      item({ id: 'step', parentId: 'feature' }),
    ]);

    const choice = chooseOvernightFire(sections, night(), MIDNIGHT, { feature: YESTERDAY });

    expect(choice.act === 'fire' && choice.feature.id).toBe('feature');
  });

  it('passes over a feature whose last run closed no steps and takes the next', () => {
    const choice = chooseOvernightFire(tree(twoFeatures()), night(), MIDNIGHT, {
      first: YESTERDAY,
    });

    expect(choice.act === 'fire' && choice.feature.id).toBe('second');
  });

  it('ends the night saying so when every ready feature is passed over', () => {
    const choice = chooseOvernightFire(tree(twoFeatures()), night(), MIDNIGHT, {
      first: YESTERDAY,
      second: YESTERDAY,
    });

    expect(choice).toEqual({ act: 'end', reason: OVERNIGHT_NO_PROGRESS });
  });

  it('still says nothing was ready when nothing was passed over', () => {
    const choice = chooseOvernightFire(
      tree([item({ id: 'mine', assignee: 'me' })]),
      night(),
      MIDNIGHT,
      {},
    );

    expect(choice).toEqual({ act: 'end', reason: OVERNIGHT_NOTHING_READY });
  });
});

describe('overnightTick', () => {
  it('fires exactly one feature and takes one off the budget', async () => {
    const { ports: p, calls } = ports();

    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired', featuresLeft: 5 });

    expect(calls.fired).toEqual([{ feature: 'feature', step: 'step' }]);
    // The count the row said was left, not the one after it.
    expect(calls.recorded).toEqual([6]);
    expect(calls.stopped).toEqual([]);
  });

  it('offers a feature again on a new run, however the last one went', async () => {
    // The zero-progress guard belongs inside one run. Read over all time it
    // takes a feature out of every night that follows: #532 was excluded from
    // 18 September onwards by a session that died before claiming its step,
    // while still handed to Claude and still ready.
    const { ports: p, calls } = ports({
      loadRun: async () => night({ startedAt: '2026-09-17T23:00:00.000Z' }),
      lastFiredAt: async () => ({ feature: YESTERDAY }),
    });

    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired' });
    expect(calls.fired).toEqual([{ feature: 'feature', step: 'step' }]);
  });

  it('still passes over a feature this run already tried without a close', async () => {
    const { ports: p, calls } = ports({
      loadRun: async () => night({ startedAt: '2026-09-17T23:00:00.000Z' }),
      lastFiredAt: async () => ({ feature: '2026-09-17T23:30:00.000Z' }),
    });

    const tick = await overnightTick(p);

    expect(tick.act).toBe('nothing-ready');
    expect(calls.fired).toEqual([]);
    expect(calls.stopped).toEqual([]);
  });

  it('fires a run with no cap without counting anything down', async () => {
    const { ports: p, calls } = ports({
      loadRun: async () => night({ featuresBudget: null, featuresLeft: null, stopBy: null }),
    });

    await expect(overnightTick(p)).resolves.toMatchObject({
      act: 'fired',
      featuresLeft: null,
    });

    expect(calls.fired).toEqual([{ feature: 'feature', step: 'step' }]);
    // Null goes through to the write, which leaves the column alone. A zero
    // here would be a spent budget and the next tick would end the run.
    expect(calls.recorded).toEqual([null]);
    expect(calls.stopped).toEqual([]);
  });

  it('changes nothing when the runner is off, and does not read the plan', async () => {
    for (const run of [null, night({ running: false })]) {
      const { ports: p, calls } = ports({ loadRun: async () => run });

      await expect(overnightTick(p)).resolves.toEqual({ act: 'idle' });
      expect(calls).toMatchObject({ sections: 0, swept: 0, fired: [], recorded: [], stopped: [] });
    }
  });

  it('changes nothing while it is paused', async () => {
    const { ports: p, calls } = ports({ loadRun: async () => night({ paused: true }) });

    await expect(overnightTick(p)).resolves.toEqual({ act: 'paused' });
    expect(calls).toMatchObject({ sections: 0, swept: 0, fired: [], recorded: [], stopped: [] });
  });

  it('changes nothing while three sessions are running', async () => {
    for (const liveness of ['working', 'quiet'] as const) {
      const { ports: p, calls } = ports({
        loadRun: async () => night({ lastFiredAt: '2026-09-17T23:30:00.000Z' }),
        runsInFlight: async () => [
          { featureId: 'a', liveness },
          { featureId: 'b', liveness },
          { featureId: 'c', liveness },
        ],
      });

      await expect(overnightTick(p)).resolves.toEqual({ act: 'waiting', liveness, running: 3 });
      // The tree is not read: every slot is taken. The claims are still
      // swept, because the ones that go stale belong to other sessions and
      // the night spends most of its ticks here.
      expect(calls).toMatchObject({ sections: 0, swept: 1, fired: [], recorded: [], stopped: [] });
    }
  });

  it('will not fire while a fire it made left no record', async () => {
    const { ports: p, calls } = ports({
      loadRun: async () => night({ lastFiredAt: '2026-09-17T23:30:00.000Z' }),
      runsInFlight: async () => [{ featureId: null, liveness: 'unknown' }],
    });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'waiting',
      liveness: 'unknown',
      running: 1,
    });
    expect(calls.fired).toEqual([]);
    expect(calls.swept).toBe(1);
  });

  it('fires the next one once a run is over', async () => {
    for (const liveness of ['ended', 'finished'] as const) {
      const { ports: p, calls } = ports({
        loadRun: async () => night({ lastFiredAt: '2026-09-17T23:30:00.000Z' }),
        runsInFlight: async () => [
          { featureId: 'a', liveness },
          { featureId: 'b', liveness: 'working' },
          { featureId: 'c', liveness: 'working' },
        ],
      });

      await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired', running: 3 });
      expect(calls.fired).toHaveLength(1);
    }
  });

  it('fires a feature in another module while one is running', async () => {
    const sections = tree([
      item({ id: 'news-feature', module: 'news', priority: 1 }),
      item({ id: 'news-step', parentId: 'news-feature', module: 'news', priority: 1 }),
      item({ id: 'learn-feature', module: 'learn', priority: 3 }),
      item({ id: 'learn-step', parentId: 'learn-feature', module: 'learn', priority: 3 }),
    ]);
    const { ports: p, calls } = ports({
      loadSections: async () => sections,
      runsInFlight: async () => [{ featureId: 'news-feature', liveness: 'working' }],
    });

    await expect(overnightTick(p)).resolves.toMatchObject({
      act: 'fired',
      step: expect.any(Number),
      running: 2,
    });
    expect(calls.fired).toEqual([{ feature: 'learn-feature', step: 'learn-step' }]);
  });

  it('waits rather than fire into a module a session is already in', async () => {
    const sections = tree([
      item({ id: 'running', module: 'news' }),
      item({ id: 'running-step', parentId: 'running', module: 'news' }),
      item({ id: 'neighbour', module: 'news' }),
      item({ id: 'neighbour-step', parentId: 'neighbour', module: 'news' }),
    ]);
    const { ports: p, calls } = ports({
      loadSections: async () => sections,
      runsInFlight: async () => [{ featureId: 'running', liveness: 'working' }],
    });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'waiting',
      liveness: 'working',
      running: 1,
    });
    expect(calls).toMatchObject({ fired: [], recorded: [], stopped: [] });
  });

  it('keeps an unreadable session in its slot and its module, and fires elsewhere', async () => {
    const sections = tree([
      item({ id: 'unread', module: 'vault', priority: 1 }),
      item({ id: 'unread-step', parentId: 'unread', module: 'vault', priority: 1 }),
      item({ id: 'vault-next', module: 'vault', priority: 1 }),
      item({ id: 'vault-next-step', parentId: 'vault-next', module: 'vault', priority: 1 }),
      item({ id: 'todo-feature', module: 'todo', priority: 3 }),
      item({ id: 'todo-step', parentId: 'todo-feature', module: 'todo', priority: 3 }),
    ]);
    const { ports: p, calls } = ports({
      loadSections: async () => sections,
      runsInFlight: async () => [{ featureId: 'unread', liveness: 'unknown' }],
    });

    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired', running: 2 });
    expect(calls.fired).toEqual([{ feature: 'todo-feature', step: 'todo-step' }]);
  });

  it('ends the night when the budget is spent, without asking anything else', async () => {
    const run = night({ featuresLeft: 0 });
    const liveness = vi.fn(async () => [{ featureId: 'a', liveness: 'working' as const }]);
    const { ports: p, calls } = ports({ loadRun: async () => run, runsInFlight: liveness });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'ended',
      reason: budgetSpentReason(run),
    });
    expect(calls.stopped).toEqual([budgetSpentReason(run)]);
    expect(liveness).not.toHaveBeenCalled();
  });

  it('ends the night when the stop time has passed', async () => {
    const { ports: p, calls } = ports({ now: Date.parse(SEVEN_AM) });

    await expect(overnightTick(p)).resolves.toEqual({ act: 'ended', reason: OVERNIGHT_TIME_UP });
    expect(calls.stopped).toEqual([OVERNIGHT_TIME_UP]);
    expect(calls.fired).toEqual([]);
  });

  it('keeps the night running when nothing is ready this minute', async () => {
    // Ready is a reading of one instant. On 18 September the night stopped at
    // 23:44 saying nothing was handed over and ready, with sixteen features of
    // budget and 2h33m of clock left; the two steps that would have been ready
    // were held by claims of dead sessions, and the sweep put them back at
    // 23:49. Nothing refused here, so asking again costs one read of the tree.
    const { ports: p, calls } = ports({
      loadSections: async () => tree([item({ id: 'mine', assignee: 'me' })]),
    });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'nothing-ready',
      reason: OVERNIGHT_NOTHING_READY,
    });
    expect(calls.stopped).toEqual([]);
    expect(calls.fired).toEqual([]);
  });

  it('puts back stale claims before it reads the plan', async () => {
    const { ports: p, calls } = ports();

    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired' });
    // The order is the whole point: a tree read before the sweep still shows
    // the dead session's step as underway, and the feature above it is refused.
    expect(calls.order).toEqual(['sweep', 'sections']);
    expect(calls.swept).toBe(1);
  });

  it('still fires when the sweep itself failed', async () => {
    const { ports: p, calls } = ports({
      sweepClaims: async () => {
        throw new Error('plan_items could not be read.');
      },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Tidying, not a precondition: a night that gave up here would lose every
    // feature it could still have fired over a table it could not write.
    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired' });
    expect(calls.fired).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('leaves the budget alone when the send itself failed', async () => {
    const { ports: p, calls } = ports({
      fire: async () => ({ ok: false, error: 'plan_runs could not be written.' }),
    });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'failed',
      error: 'plan_runs could not be written.',
    });
    expect(calls.recorded).toEqual([]);
    expect(calls.stopped).toEqual([]);
  });

  it('does not work down the tree when the send broke rather than refused', async () => {
    const tried: string[] = [];
    const { ports: p, calls } = ports({
      loadSections: async () => tree(twoFeatures()),
      fire: async (feature) => {
        tried.push(feature.id);
        return { ok: false, error: 'plan_runs could not be written.' };
      },
    });

    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'failed' });
    // The second feature would be handed to the same routine over the same
    // connection, so trying it costs a candidate and buys nothing.
    expect(tried).toEqual(['first']);
    expect(calls.stopped).toEqual([]);
  });

  it('fires the next ready feature when the send refuses the first', async () => {
    const sections = tree(twoFeatures());
    const first = findNode(sections, 'first')!;
    const tried: string[] = [];
    const { ports: p, calls } = ports({
      loadSections: async () => sections,
      fire: async (feature) => {
        tried.push(feature.id);
        return feature.id === 'first'
          ? {
              ok: false,
              error: `#${first.number} is only a proposal. Approve it first.`,
              refused: true,
            }
          : { ok: true };
      },
    });

    await expect(overnightTick(p)).resolves.toMatchObject({
      act: 'fired',
      refused: [first.number],
    });
    // Both were tried, in the chooser's order, and the budget went down once.
    expect(tried).toEqual(['first', 'second']);
    expect(calls.recorded).toEqual([6]);
    expect(calls.stopped).toEqual([]);
  });

  it('keeps the night running, naming every feature that refused', async () => {
    const sections = tree(twoFeatures());
    const first = findNode(sections, 'first')!;
    const second = findNode(sections, 'second')!;
    const { ports: p, calls } = ports({
      loadSections: async () => sections,
      fire: async (feature) => ({
        ok: false,
        refused: true,
        error:
          feature.id === 'first'
            ? `#${first.number} is only a proposal. Approve it first.`
            : 'Nothing open under that step that is not waiting on you.',
      }),
    });

    const tick = await overnightTick(p);

    // A refusal is a reading of one instant like any other. Two of the three
    // reasons a send refuses -- a re-shape rewriting the feature, a claim still
    // live beneath it -- clear themselves with nobody watching, and on
    // 19 September a run with no limit stopped twenty-one minutes in because
    // two features refused for a re-shape that had died.
    expect(tick.act).toBe('nothing-ready');
    const reason = tick.act === 'nothing-ready' ? tick.reason : '';
    expect(reason).toContain(`#${first.number} is only a proposal.`);
    // The refusal that names no feature gets the number put in front of it.
    expect(reason).toContain(`#${second.number}: Nothing open under that step`);
    expect(calls.stopped).toEqual([]);
    expect(calls.recorded).toEqual([]);
  });

  it('says so when the last candidates were passed over rather than refused', async () => {
    const sections = tree(twoFeatures());
    const first = findNode(sections, 'first')!;
    const { ports: p } = ports({
      loadSections: async () => sections,
      // Inside this run's window, so the guard passes it over. A fire from
      // before the run started is another run's business.
      lastFiredAt: async () => ({ second: '2026-09-17T23:30:00.000Z' }),
      fire: async () => ({
        ok: false,
        refused: true,
        error: `#${first.number} is only a proposal. Approve it first.`,
      }),
    });

    const tick = await overnightTick(p);
    const reason = tick.act === 'nothing-ready' ? tick.reason : '';

    // "Every feature left refused" would not be true: one was never offered.
    expect(reason).toContain('what had not already been tried');
    expect(reason).toContain(`#${first.number} is only a proposal.`);
  });
});

describe('overnightRefusedReason', () => {
  it('names each refusal once, with a full stop', () => {
    expect(
      overnightRefusedReason(
        [
          { number: 640, error: '#640 is only a proposal. Approve it first.' },
          { number: 651, error: 'That step no longer exists' },
        ],
        OVERNIGHT_NOTHING_READY,
      ),
    ).toBe(
      'Every feature left refused the send, so it stopped rather than retrying them. ' +
        '#640 is only a proposal. Approve it first. #651: That step no longer exists.',
    );
  });
});

/**
 * The CI reading, which is the one thing a tick does unconditionally.
 *
 * Everything else in this file is about restraint -- a tick with the runner off
 * must not so much as read the plan. This is the exception and it is the point
 * of #639: main sat red for two hours with nobody running a night and nobody
 * on /dev/plan, so the app knew nothing. The read therefore sits in front of
 * the `running` filter, not behind it.
 */
describe('runOvernightTick', () => {
  const NOW = Date.parse('2026-09-18T21:40:00.000Z');
  const HEAD = 'a405587bd91f0c3e2d4a6b8c9f1e2d3a4b5c6d7e';

  /** No account is running, and the one write there is gets captured. */
  function quietNight() {
    const upsert = vi.fn(async () => ({ error: null as null }));
    const accounts = { data: [] as Array<{ user_id: string }>, error: null };
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      limit: () => Promise.resolve(accounts),
      upsert,
    });
    return { upsert, supabase: { from: () => chain } as never };
  }

  const green = () =>
    vi.fn(async (url: string) =>
      String(url).includes('/actions/runs')
        ? new Response(
            JSON.stringify({ workflow_runs: [{ status: 'completed', conclusion: 'success' }] }),
            { status: 200 },
          )
        : new Response(JSON.stringify([{ sha: HEAD, parents: [] }]), { status: 200 }),
    );

  it("reads and stores main's CI on a tick with no night running", async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, upsert } = quietNight();

    const summary = await runOvernightTick({ supabase, now: NOW, fetch: green() as never });

    expect(summary.accounts).toBe(0);
    expect(summary.fired).toBe(0);
    expect(summary.main).toEqual({
      sha: HEAD,
      conclusion: 'passed',
      error: null,
      reason: null,
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect((upsert.mock.calls as unknown as unknown[][])[0]?.[0]).toMatchObject({
      repo: 'knightx4/PersonalDashboard',
      head_sha: HEAD,
      conclusion: 'passed',
    });
    vi.unstubAllEnvs();
  });

  it('still runs the nights when the CI read is the thing that broke', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase } = quietNight();
    const refused = vi.fn(async () => new Response('{}', { status: 403 }));

    const summary = await runOvernightTick({ supabase, now: NOW, fetch: refused as never });

    // The refusal is a stored reading, not a thrown one: the dot goes grey and
    // says why, and the tick carries on to the accounts it came for.
    expect(summary.main.conclusion).toBeNull();
    expect(summary.main.error).toContain('GITHUB_READ_TOKEN');
    expect(summary.accounts).toBe(0);
    vi.unstubAllEnvs();
  });
});

describe('tickNote', () => {
  it('says why the runner is waiting, in the reason it worked out', () => {
    expect(tickNote({ act: 'nothing-ready', reason: '#723 is being re-read.' })).toBe(
      'Waiting until something is ready. #723 is being re-read.',
    );
    expect(tickNote({ act: 'waiting', liveness: 'working', running: 3 })).toBe(
      'Waiting: 3 sessions are running, the most it starts at once.',
    );
    expect(tickNote({ act: 'waiting', liveness: 'working', running: 1 })).toBe(
      'Waiting: one session is running, and nothing else is ready outside its module.',
    );
    expect(tickNote({ act: 'waiting', liveness: 'unknown', running: 2 })).toContain(
      'GitHub could not be asked',
    );
  });

  it('names what it started, and says nothing for an idle or held runner', () => {
    expect(
      tickNote({
        act: 'fired',
        feature: 791,
        step: 792,
        featuresLeft: null,
        refused: [],
        running: 1,
      }),
    ).toBe('Started #791.');
    expect(
      tickNote({
        act: 'fired',
        feature: 791,
        step: 792,
        featuresLeft: null,
        refused: [],
        running: 2,
      }),
    ).toBe('Started #791. 2 sessions are running.');
    expect(tickNote({ act: 'idle' })).toBeNull();
    expect(tickNote({ act: 'paused' })).toBeNull();
  });
});

describe('outsideRunning', () => {
  it('takes out the running features and every feature in their modules', () => {
    const sections = tree([
      item({ id: 'news-a', module: 'news' }),
      item({ id: 'news-b', module: 'news' }),
      item({ id: 'learn-a', module: 'learn' }),
    ]);
    const ids = outsideRunning(sections, ['news-a']).flatMap((one) => one.nodes.map((n) => n.id));
    expect(ids).toEqual(['learn-a']);
  });

  it('treats features with no module as one group', () => {
    const sections = tree([
      item({ id: 'loose-a', module: null }),
      item({ id: 'loose-b', module: null }),
      item({ id: 'todo-a', module: 'todo' }),
    ]);
    const ids = outsideRunning(sections, ['loose-a']).flatMap((one) => one.nodes.map((n) => n.id));
    expect(ids).toEqual(['todo-a']);
  });

  it('holds back only itself when the running feature is not in the tree', () => {
    const sections = tree([item({ id: 'todo-a', module: 'todo' })]);
    const ids = outsideRunning(sections, ['gone']).flatMap((one) => one.nodes.map((n) => n.id));
    expect(ids).toEqual(['todo-a']);
  });
});

describe('featureRunsInFlight', () => {
  /** plan_runs as a chain that answers the one read with these rows. */
  function runsTable(
    rows: Array<{ plan_item_id: string | null; status: string; created_at: string }>,
  ) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: async () => ({ data: rows, error: null }),
    };
    return { from: () => chain } as never;
  }
  const hoursBefore = (hours: number) => new Date(MIDNIGHT - hours * 3_600_000).toISOString();

  it('says a recent fire that left no row is an unreadable session', async () => {
    const runs = await featureRunsInFlight({
      supabase: runsTable([]),
      userId: 'u',
      run: night({ lastFiredAt: hoursBefore(1) }),
      now: MIDNIGHT,
    });
    expect(runs).toEqual([{ featureId: null, liveness: 'unknown' }]);
  });

  it('does not hold a long night on a fire too old for its row to be read', async () => {
    const runs = await featureRunsInFlight({
      supabase: runsTable([]),
      userId: 'u',
      run: night({ lastFiredAt: hoursBefore(7) }),
      now: MIDNIGHT,
    });
    expect(runs).toEqual([]);
  });

  it('leaves out runs already written back as over', async () => {
    const runs = await featureRunsInFlight({
      supabase: runsTable([
        { plan_item_id: 'a', status: 'finished', created_at: hoursBefore(1) },
        { plan_item_id: 'b', status: 'failed', created_at: hoursBefore(2) },
      ]),
      userId: 'u',
      run: night({ lastFiredAt: hoursBefore(1) }),
      now: MIDNIGHT,
    });
    expect(runs).toEqual([]);
  });
});

describe('featureRunLiveness', () => {
  const started = new Date(MIDNIGHT - 60 * 60_000).toISOString();
  const minutesAgo = (minutes: number) => new Date(MIDNIGHT - minutes * 60_000).toISOString();

  /** A feature with one closed step and one more, claimed or not. */
  function plan(nextStatus: string, closed = minutesAgo(25)) {
    const rows = [
      { id: 'feature', parent_id: null, status: 'not_started', updated_at: started },
      { id: 'first', parent_id: 'feature', status: 'done', updated_at: closed },
      { id: 'next', parent_id: 'feature', status: nextStatus, updated_at: closed },
    ];
    const result = { data: rows, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: async () => result,
    };
    return {
      rpc: async (fn: string) => ({
        data: fn === 'plan_subtree_closed_at' ? closed : null,
        error: null,
      }),
      from: () => chain,
    } as never;
  }

  it('reads a session that closed a step and claimed the next as still working', async () => {
    const liveness = await featureRunLiveness({
      supabase: plan('in_progress'),
      userId: 'u',
      row: { plan_item_id: 'feature', status: 'started', created_at: started },
      now: MIDNIGHT,
      pushes: [],
    });
    expect(liveness).toBe('working');
  });

  it('reads a session between one step and the next as still working', async () => {
    const liveness = await featureRunLiveness({
      supabase: plan('not_started', minutesAgo(1)),
      userId: 'u',
      row: { plan_item_id: 'feature', status: 'started', created_at: started },
      now: MIDNIGHT,
      pushes: [],
    });
    expect(liveness).toBe('working');
  });

  it('reads it as finished once nothing is claimed or changed for twenty minutes', async () => {
    const liveness = await featureRunLiveness({
      supabase: plan('not_started'),
      userId: 'u',
      row: { plan_item_id: 'feature', status: 'started', created_at: started },
      now: MIDNIGHT,
      pushes: [],
    });
    expect(liveness).toBe('finished');
  });
});

/**
 * What the Overnight card says while a night is running.
 *
 * The card used to print the standing, how many features were left and how
 * long there was on the clock -- and a night working its way down the plan
 * printed exactly what a night that fell over on its first feature printed.
 * #633 is that gap, so these are the facts that close it: the totals, the
 * feature it is on, and the last commit. Rendered rather than asserted about
 * the helpers, because a line the helpers compute and the card forgets to draw
 * is the whole of the bug.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DigestNight } from '@/lib/digest/night';
import type { StoredPush } from '@/lib/plan/liveness';
import type { OvernightRun } from '@/lib/plan/overnight';

// The server actions pull in the session client, which has no business in a
// render test; the card only needs them to exist to hand to its forms.
vi.mock('@/app/dev/plan/actions', () => {
  const noop = async () => ({});
  return {
    pauseOvernightRunner: noop,
    resumeOvernightRunner: noop,
    startOvernightRunner: noop,
    stopOvernightRunner: noop,
  };
});

const NOW = Date.parse('2026-09-17T04:30:00Z');

// The clock is zero until the first tick after mount, which is what keeps the
// server and the first client render in step. A render test that left it there
// could never see an elapsed figure, so it is wound forward here and the
// hydration rule is checked on its own below.
vi.mock('@/lib/use-clock-now', () => ({ useClockNow: () => NOW }));

// The card refreshes the page once a running night's readings come back, so it
// asks for the router. A static render has no app router mounted to give it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { OvernightControl } = await import('@/app/dev/plan/overnight-control');

function run(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'run-1',
    running: true,
    paused: false,
    featuresBudget: 4,
    featuresLeft: 3,
    stopBy: '2026-09-17T09:40:00Z',
    startedAt: '2026-09-16T23:00:00Z',
    lastFiredAt: '2026-09-17T04:04:00Z',
    endedAt: null,
    endedReason: null,
    lastTickAt: null,
    lastTickNote: null,
    createdAt: '2026-09-16T23:00:00Z',
    updatedAt: '2026-09-17T04:04:00Z',
    ...over,
  };
}

function night(over: Partial<DigestNight> = {}): DigestNight {
  return {
    standing: 'running',
    startedAt: '2026-09-16T23:00:00Z',
    endedAt: null,
    endedReason: null,
    featuresBudget: 4,
    featuresLeft: 3,
    features: [
      {
        ref: '#494',
        title: 'The dev pages say what is actually happening',
        at: '2026-09-17T04:04:00Z',
      },
    ],
    lastFire: {
      ref: '#494',
      title: 'The dev pages say what is actually happening',
      at: '2026-09-17T04:04:00Z',
    },
    closed: Array.from({ length: 9 }, (_, index) => ({
      ref: `#${600 + index}`,
      title: `Step ${600 + index}`,
      feature: null,
      ask: null,
    })),
    blocked: [],
    ...over,
  };
}

// As the run row remembers it: what the route asked GitHub and wrote down.
const PUSH: StoredPush = {
  at: '2026-09-17T04:22:00Z',
  sha: 'a4f09127c4d1e6b0f2a3c5d7e9b1c3d5f7a9b1c3',
  subject: 'Store what GitHub last said about a run (plan #568)',
};

function draw(props: Partial<Parameters<typeof OvernightControl>[0]> = {}): string {
  return renderToStaticMarkup(
    <OvernightControl run={run()} canSend night={night()} push={PUSH} ready={3} {...props} />,
  );
}

describe('the Overnight card while a night is running', () => {
  it('leads with what the night has got through', () => {
    const html = draw();
    expect(html).toContain('1 of 4 features spent');
    expect(html).toContain('9 steps closed');
    // The budget read the old way round is gone: two readings of one pair of
    // numbers on one card is the arithmetic #633 was meant to save.
    expect(html).not.toContain('features left');
  });

  it('names the feature it is on, and how long it has been on it', () => {
    const html = draw();
    expect(html).toContain('#494');
    expect(html).toContain('The dev pages say what is actually happening');
    expect(html).toContain('26m');
  });

  it('shows the most recent commit by what it says, not by its sha', () => {
    const html = draw();
    expect(html).toContain('Store what GitHub last said about a run (plan #568)');
    expect(html).not.toContain('a4f0912');
  });

  it('cuts a subject too long for the line rather than running it across the card', () => {
    const html = draw({ push: { ...PUSH, subject: `${'Refuse '.repeat(30)}the plan` } });
    expect(html).toContain('…');
    expect(html).not.toContain('Refuse '.repeat(30));
  });

  it('falls back to the commit when GitHub would not say what it was', () => {
    const html = draw({ push: { ...PUSH, subject: null } });
    // The short sha: a thing that can be looked up, where the stored reading
    // has no branch to name.
    expect(html).toContain('a4f0912');
  });

  it('keeps the step numbers reachable but out of the line', () => {
    const html = draw();
    expect(html).toContain('Which steps');
    expect(html).toContain('#607');
    // Under a fold: closed, so nothing has to be parsed at a glance.
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
  });

  it('says how many features are left for it to pick up, not how many steps', () => {
    expect(draw()).toContain('3 features ready');
  });

  it('says a night with budget left has nothing to fire, where that is true', () => {
    // The pair #633 could not tell apart from the other side: the budget says
    // there is room for three more and the plan has nothing to put in it.
    const html = draw({ ready: 0 });
    expect(html).toContain('1 of 4 features spent');
    expect(html).toContain('no features ready');
  });

  it('still says what is ready on a card with no night running', () => {
    const html = draw({
      run: run({ running: false, endedAt: '2026-09-17T04:00:00Z', endedReason: 'You stopped it.' }),
      night: null,
      push: null,
      ready: 1,
    });

    expect(html).toContain('1 feature ready');
  });

  it('still says how much clock is left', () => {
    expect(draw()).toContain('stops in 5h 10m');
  });

  // Note 39576272: sessions running in parallel each get an On line.
  it('names every row a session is on when several are running', () => {
    const html = draw({
      on: [
        { ref: '#723', title: 'Newest session', at: '2026-09-17T04:20:00Z', step: null },
        {
          ref: '#494',
          title: 'The dev pages say what is actually happening',
          at: '2026-09-17T04:04:00Z',
          step: null,
        },
      ],
    });

    expect((html.match(/On <span/g) ?? []).length).toBe(2);
    expect(html.indexOf('#723')).toBeLessThan(html.indexOf('#494'));
    expect(html).toContain('Newest session');
  });

  it('gives each session its own progress through its feature', () => {
    const html = draw({
      on: [
        {
          ref: '#723',
          title: 'Newest session',
          at: '2026-09-17T04:20:00Z',
          step: null,
          progress: { done: 2, total: 5 },
        },
      ],
    });
    expect(html).toContain('2 of 5 steps done');
  });

  it('says how long the night has been going and that it has no stop time', () => {
    const html = draw({ run: run({ stopBy: null }) });
    expect(html).toContain('Started 5h 30m ago');
    expect(html).toContain('no stop time');
  });

  it('names the features the next ticks would fire', () => {
    const html = draw({ next: [{ ref: '#950', title: 'Add a payment method' }] });
    expect(html).toContain('Next up');
    expect(html).toContain('Add a payment method');
  });

  it('falls back to the last fire when no run is going', () => {
    const html = draw({ on: [] });
    expect((html.match(/On <span/g) ?? []).length).toBe(1);
    expect(html).toContain('#494');
  });

  // Note 84482e92: the claimed step hangs under the feature it belongs to.
  it('names the step being worked under the feature it is on', () => {
    const html = draw({
      run: run(),
      night: night({
        lastFire: {
          ref: '#494',
          title: 'The dev pages say what is actually happening',
          at: '2026-09-17T04:04:00Z',
          step: { ref: '#494.3', title: 'Say what the runner is on' },
        },
      }),
      push: null,
    });

    expect(html).toContain('Working on</span>');
    expect(html).toContain('#494.3');
    expect(html).toContain('Say what the runner is on');
  });

  it('does not read like a working night when it has fired nothing', () => {
    const html = draw({
      run: run({ featuresLeft: 4, lastFiredAt: null }),
      night: night({ featuresLeft: 4, features: [], lastFire: null, closed: [] }),
      push: null,
    });

    expect(html).toContain('0 of 4 features spent');
    expect(html).toContain('no steps closed');
    expect(html).toContain('Nothing has been fired yet');
    expect(html).not.toContain('On <');
    expect(html).not.toContain('Which steps');
  });

  it('says a held night is held as well as saying what it was on', () => {
    const html = draw({
      run: run({ paused: true }),
      night: night({ standing: 'paused' }),
    });

    expect(html).toContain('#494');
    expect(html).toContain('nothing new is fired until you resume');
  });

  it('has nothing to draw about a night when there is none', () => {
    const html = draw({
      run: run({ running: false, endedAt: '2026-09-17T04:00:00Z', endedReason: 'You stopped it.' }),
      night: null,
      push: null,
    });

    expect(html).toContain('You stopped it.');
    expect(html).not.toContain('steps closed');
    expect(html).not.toContain('Last push');
  });
});

describe('the Overnight card before the browser clock arrives', () => {
  it('leaves every clock-derived figure out rather than drawing it from zero', async () => {
    vi.resetModules();
    vi.doMock('@/lib/use-clock-now', () => ({ useClockNow: () => 0 }));
    const { OvernightControl: AtZero } = await import('@/app/dev/plan/overnight-control');

    const html = renderToStaticMarkup(
      <AtZero run={run()} canSend night={night()} push={PUSH} ready={3} />,
    );

    // The facts that do not come off a clock are all still there.
    expect(html).toContain('1 of 4 features spent');
    expect(html).toContain('#494');
    expect(html).toContain('Store what GitHub last said about a run (plan #568)');
    // The ones that do are absent, so the line does not change shape on
    // hydration.
    expect(html).not.toContain('26m');
    expect(html).not.toContain('stops in');
    vi.doUnmock('@/lib/use-clock-now');
  });
});

describe('the steps a night left blocked', () => {
  const blocked = night({
    blocked: [{ ref: '#700', title: 'Needs a key', feature: null, ask: 'Add the token' }],
  });

  it('are listed on the plan page', () => {
    expect(draw({ night: blocked })).toContain('1 step blocked on you');
  });

  it('are left to the waiting list on Dash, where the status card turns them off', () => {
    const html = draw({ night: blocked, showBlocked: false });
    expect(html).not.toContain('blocked on you');
    expect(html).not.toContain('Needs a key');
  });
});

describe('a stopped night on Dash', () => {
  const stopped = {
    run: run({ running: false, endedAt: '2026-09-17T04:00:00Z', endedReason: 'You stopped it.' }),
    night: night({
      standing: 'stopped',
      endedAt: '2026-09-17T04:00:00Z',
      endedReason: 'You stopped it.',
    }),
  };

  it('starts clean, saying only what is ready', () => {
    const html = draw({ ...stopped, fresh: true, readySteps: 7 });
    expect(html).toContain('Ready');
    expect(html).toContain('3 features ready · 7 steps');
    expect(html).not.toContain('Stopped');
    expect(html).not.toContain('You stopped it.');
    expect(html).not.toContain('Ended');
    expect(html).not.toContain('Which steps');
    expect(html).not.toContain('features spent');
  });

  it('reads as off when nothing is ready', () => {
    const html = draw({ ...stopped, fresh: true, ready: 0 });
    expect(html).toContain('Off');
    expect(html).toContain('no features ready');
  });

  it('keeps the last run’s account on the plan page', () => {
    expect(draw(stopped)).toContain('You stopped it.');
  });
});

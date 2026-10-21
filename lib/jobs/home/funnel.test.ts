import { describe, expect, it } from 'vitest';
import { buildFunnel, headline, stageOf, type FunnelApplicationInput, type FunnelSuggestionInput } from './funnel';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

let n = 0;
function app(over: Partial<FunnelApplicationInput>): FunnelApplicationInput {
  n += 1;
  return {
    applicationId: `a${n}`,
    roleId: `r${n}`,
    companyName: `Company ${n}`,
    roleTitle: 'Strategic Finance',
    status: 'lead',
    submittedAt: null,
    firstHumanResponseAt: null,
    closedAt: null,
    lastActivityAt: ago(1),
    lastTurnEvent: null,
    interviewKinds: [],
    ...over,
  };
}

function suggestion(status: string, createdDays: number, actedDays: number | null = null): FunnelSuggestionInput {
  n += 1;
  return { id: `s${n}`, name: `Startup ${n}`, headline: 'A role', status, createdAt: ago(createdDays), actedAt: actedDays === null ? null : ago(actedDays) };
}

function stage(view: ReturnType<typeof buildFunnel>, key: string) {
  return view.stages.find((s) => s.key === key)!;
}

describe('stageOf', () => {
  it('splits the answered ones by whose move it is', () => {
    expect(stageOf(app({ status: 'in_process', lastTurnEvent: 'recruiter_reply' }))).toBe('traction');
    expect(stageOf(app({ status: 'in_process', lastTurnEvent: null }))).toBe('waiting');
    expect(stageOf(app({ status: 'final_round', lastTurnEvent: 'interview_scheduled' }))).toBe('traction');
  });

  it('puts leads, sent, offers and closed where the board does', () => {
    expect(stageOf(app({ status: 'drafting' }))).toBe('leads');
    expect(stageOf(app({ status: 'acknowledged' }))).toBe('applied');
    expect(stageOf(app({ status: 'offer' }))).toBe('offers');
    expect(stageOf(app({ status: 'ghosted' }))).toBeNull();
  });
});

describe('buildFunnel', () => {
  it('fills each stage with its rows, newest first, and marks the ones sat two weeks', () => {
    const view = buildFunnel({
      now: NOW,
      applications: [
        app({ status: 'acknowledged', submittedAt: ago(20), lastActivityAt: ago(20), companyName: 'Basis' }),
        app({ status: 'acknowledged', submittedAt: ago(2), lastActivityAt: ago(2), companyName: 'Decagon' }),
      ],
      suggestions: [suggestion('open', 3)],
      interviewsHeld: [],
      watched: 133,
      replyRate: null,
    });
    const applied = stage(view, 'applied');
    expect(applied.items.map((i) => i.name)).toEqual(['Decagon', 'Basis']);
    expect(applied.items.map((i) => i.stale)).toEqual([false, true]);
    expect(applied.note).toBe('1 is past two weeks with nothing back.');
    expect(stage(view, 'sourcing').items).toHaveLength(1);
    expect(stage(view, 'sourcing').items[0]!.href).toBe('/jobs/find');
    expect(view.watched).toBe(133);
  });

  it('counts what moved inside the window only', () => {
    const view = buildFunnel({
      now: NOW,
      applications: [
        app({ status: 'acknowledged', submittedAt: ago(5) }),
        app({ status: 'acknowledged', submittedAt: ago(45) }),
        app({ status: 'in_process', submittedAt: ago(20), firstHumanResponseAt: ago(4), interviewKinds: ['screen'] }),
      ],
      suggestions: [suggestion('done', 10, 9), suggestion('done', 60, 50), suggestion('dismissed', 3), suggestion('expired', 40)],
      interviewsHeld: [{ applicationId: 'x', scheduledAt: ago(2) }, { applicationId: 'x', scheduledAt: ago(1) }],
      watched: null,
      replyRate: null,
    });
    const flow = (from: string) => view.flows.find((f) => f.from === from)!;
    expect(flow('sourcing').count).toBe(1);
    expect(flow('leads').count).toBe(2);
    expect(flow('applied').count).toBe(1);
    expect(flow('traction').count).toBe(1);
    expect(view.drops).toEqual([{ from: 'sourcing', count: 1, label: 'passed on', parts: '1 dismissed' }]);
  });

  it('gives each closed application to the stage it got to, largest cause first', () => {
    const view = buildFunnel({
      now: NOW,
      applications: [
        app({ status: 'ghosted', submittedAt: ago(40), closedAt: ago(3) }),
        app({ status: 'ghosted', submittedAt: ago(40), closedAt: ago(4) }),
        app({ status: 'rejected', submittedAt: ago(20), closedAt: ago(2) }),
        app({ status: 'rejected', submittedAt: ago(20), firstHumanResponseAt: ago(10), closedAt: ago(2) }),
        app({ status: 'role_closed', submittedAt: ago(90), closedAt: ago(60) }),
      ],
      suggestions: [],
      interviewsHeld: [],
      watched: null,
      replyRate: null,
    });
    expect(view.drops).toEqual([
      { from: 'applied', count: 3, label: 'closed', parts: '2 ghosted · 1 rejected' },
      { from: 'traction', count: 1, label: 'closed', parts: '1 rejected' },
    ]);
  });

  it('puts the search’s reply rate on the band out of Applied, and no rate where there is none', () => {
    const base = { now: NOW, applications: [], suggestions: [], interviewsHeld: [], watched: null };
    expect(buildFunnel({ ...base, replyRate: 0.0984 }).flows.find((f) => f.from === 'applied')!.rate).toBe('10% reply rate');
    expect(buildFunnel({ ...base, replyRate: null }).flows.every((f) => f.rate === null)).toBe(true);
  });
});

describe('headline', () => {
  it('names the warmest conversation and the stage losing the most', () => {
    const view = buildFunnel({
      now: NOW,
      applications: [
        app({ status: 'in_process', companyName: 'Heron Data', lastTurnEvent: 'interview_scheduled', lastActivityAt: ago(1), firstHumanResponseAt: ago(5) }),
        app({ status: 'in_process', companyName: 'Array', lastActivityAt: ago(26), firstHumanResponseAt: ago(40) }),
        app({ status: 'ghosted', submittedAt: ago(40), closedAt: ago(3) }),
      ],
      suggestions: [],
      interviewsHeld: [],
      watched: null,
      replyRate: null,
    });
    expect(view.headline.parts.map((p) => p.text).join('')).toBe(
      'Two conversations are live. Heron Data is the warmest, and Applied is where the search leaks.',
    );
    expect(view.headline.parts.find((p) => p.stage)).toEqual({ text: 'Heron Data', stage: 'traction' });
  });

  it('never calls Sourcing the leak, since passing on a suggestion is a choice', () => {
    const live = [{ id: 'x', name: 'Array', what: '', days: 3, stale: false, href: '' }];
    const stages = [{ key: 'traction' as const, label: 'Traction', note: '', items: live }];
    const drops = [{ from: 'sourcing' as const, count: 76, label: 'passed on', parts: '' }];
    expect(headline(stages, drops).parts.map((p) => p.text).join('')).toBe('One conversation is live. Array is the one to watch.');
  });

  it('says how many are out when nothing is past the first reply', () => {
    expect(headline([{ key: 'applied', label: 'Applied', note: '', items: [] }], []).parts[0]!.text).toBe(
      'Nothing is past the first reply yet. No applications are out.',
    );
  });
});

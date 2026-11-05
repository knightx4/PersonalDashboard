import { describe, expect, it } from 'vitest';
import { questionWork } from './dash-work';
import { keyWords, pickGoal, takeOnHref, takeOnPayload, takeOnReply, takeOnRunText, type EndedQuestion } from './take-on';
import { runTakeOnReports, type TakeOnReportPorts } from './take-on-report';

const LOANS = { id: 'g-loans', title: 'Pay off the student loans', acceptance: 'Every loan balance is zero' };
const FLAT = { id: 'g-flat', title: 'Furnish the new apartment', acceptance: null };
const RUN = '11111111-1111-4111-8111-111111111111';

describe('pickGoal', () => {
  it('picks the goal a question shares words with', () => {
    expect(pickGoal('should I consolidate my loans', [FLAT, LOANS])).toEqual({ kind: 'goal', goal: LOANS });
  });

  it('asks which when nothing matches, naming the goals', () => {
    const pick = pickGoal('what should I do this weekend', [FLAT, LOANS]);
    expect(pick.kind).toBe('ask');
    if (pick.kind === 'ask') expect(pick.candidates.map((g) => g.id)).toEqual(['g-flat', 'g-loans']);
  });

  it('asks which on a tie, naming only the goals that matched', () => {
    const loans = { ...LOANS, acceptance: null };
    const other = { id: 'g-car', title: 'Pay off the car loan', acceptance: null };
    const pick = pickGoal('when can I pay off the loan', [FLAT, loans, other]);
    expect(pick).toEqual({ kind: 'ask', candidates: [loans, other] });
  });

  it('drops plurals and common words', () => {
    expect([...keyWords('Should I consolidate my loans?')]).toEqual(['consolidate', 'loan']);
  });
});

const ended: EndedQuestion = {
  runId: RUN,
  userId: 'u',
  goalId: 'g-loans',
  goalTitle: 'Pay off the student loans',
  question: 'should I consolidate my loans',
  origin: 'ask_dash',
  originRef: 'conv-1',
  status: 'done',
  summary: 'Not yet: consolidating would raise the rate on two of the four loans.\n\n## Why\n…',
  error: null,
  suggested: 1,
};

describe('reporting back', () => {
  it('sends Done with the question, the answer and the link to the result', () => {
    const payload = takeOnPayload(ended);
    expect(payload.title).toBe('Done: should I consolidate my loans');
    expect(payload.body).toBe('Not yet: consolidating would raise the rate on two of the four loans. One suggestion waits on Add.');
    expect(payload.url).toBe(`/goals/g-loans?work=${RUN}#work-${RUN}`);
    expect(payload.url).toBe(takeOnHref('g-loans', RUN));
  });

  it('writes a reply line citing the goal at the result', () => {
    const reply = takeOnReply(ended);
    expect(reply.body).toContain('Done: should I consolidate my loans');
    expect(reply.body).toContain('one suggestion waits on Add');
    expect(reply.citations).toEqual([
      { table: 'goals.items', ref: 'g-loans', title: 'Pay off the student loans', href: takeOnHref('g-loans', RUN) },
    ]);
  });

  it('says a failed run stopped', () => {
    const payload = takeOnPayload({ ...ended, status: 'failed', summary: null, error: 'The session ended. Nothing was written.' });
    expect(payload.title).toBe('Stopped: should I consolidate my loans');
    expect(payload.body).toBe('Dash could not finish it: The session ended.');
  });

  it('briefs the run to suggest rather than change', () => {
    const text = takeOnRunText({ goalId: 'g', goalTitle: 'Loans', userId: 'u', runId: RUN, question: 'should I?', origin: 'chat' });
    expect(text).toContain('> should I?');
    expect(text).toContain('in a Claude chat');
    expect(text).toContain('reference/question.md');
    expect(text).toContain(RUN);
  });
});

function ports(runs: EndedQuestion[], status = 201) {
  const calls: string[] = [];
  const claimed = new Set<string>();
  const p: TakeOnReportPorts = {
    due: async () => runs,
    claim: async (run) => {
      if (claimed.has(run.runId)) return false;
      claimed.add(run.runId);
      calls.push(`claim ${run.runId}`);
      return true;
    },
    release: async (run) => {
      claimed.delete(run.runId);
      calls.push(`release ${run.runId}`);
    },
    reply: async (run) => {
      calls.push(`reply ${run.originRef}`);
    },
    push: () =>
      ({
        subscriptions: async () => [{ id: 's', endpoint: 'https://push.example/e', p256dh: 'p', auth: 'a' }],
        send: async () => status,
        forget: async () => {},
        sent: async () => {},
      }) as unknown as ReturnType<TakeOnReportPorts['push']>,
  };
  return { p, calls };
}

describe('runTakeOnReports', () => {
  it('replies in Ask Dash and notifies, once', async () => {
    const { p, calls } = ports([ended]);
    const summary = await runTakeOnReports(p, new Date('2026-11-04T12:00:00Z'));
    expect(summary.failed).toEqual([]);
    expect(calls).toEqual([`claim ${RUN}`, 'reply conv-1']);
    expect(summary.outcomes[0]).toMatchObject({ kind: 'reported', replied: true });
  });

  it('writes no reply for a Claude chat', async () => {
    const { p, calls } = ports([{ ...ended, origin: 'chat', originRef: null }]);
    await runTakeOnReports(p, new Date());
    expect(calls).toEqual([`claim ${RUN}`]);
  });

  it('skips a run another pass claimed', async () => {
    const { p } = ports([ended, ended]);
    const summary = await runTakeOnReports(p, new Date());
    expect(summary.outcomes.map((o) => o.kind)).toEqual(['reported', 'taken']);
  });
});

describe('questionWork', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const base = { createdAt: '2026-11-04T11:00:00Z', summary: null, error: null, lastSeenAt: '2026-11-04T11:59:00Z', nowOn: 'Reading the loan statements' };

  it('shows a running question as Dash’s work with the question as its title', () => {
    const work = questionWork([{ ...base, id: RUN, status: 'started', endedAt: null, question: 'consolidate?' }], 'g', now);
    expect(work.running).toEqual([
      expect.objectContaining({ title: 'consolidate?', state: 'running', href: takeOnHref('g', RUN) }),
    ]);
    expect(work.results).toEqual([]);
  });

  it('keeps an old result only when the link names it', () => {
    const old = { ...base, id: RUN, status: 'done' as const, endedAt: '2026-11-01T10:00:00Z', summary: 'Not yet.', question: 'q' };
    expect(questionWork([old], 'g', now).results).toEqual([]);
    expect(questionWork([old], 'g', now, RUN).results).toEqual([{ runId: RUN, question: 'q', state: 'done', text: 'Not yet.' }]);
  });
});

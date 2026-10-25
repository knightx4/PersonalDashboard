import { describe, expect, it } from 'vitest';
import {
  HISTORY_EXAMPLES,
  channelOf,
  recentMonths,
  isSimilarTitle,
  reachedInterview,
  summariseHistory,
  titleLevel,
  workStems,
  type PastApplication,
} from './history';

let next = 0;
function app(patch: Partial<PastApplication> & { title: string }): PastApplication {
  next += 1;
  return {
    id: `a${next}`,
    company: 'Acme',
    status: 'ghosted',
    rejectionStage: null,
    hasInterview: false,
    ...patch,
  };
}

describe('reachedInterview', () => {
  it('counts an interview on file, a later status, or a rejection after the screen', () => {
    expect(reachedInterview(app({ title: 'x', hasInterview: true }))).toBe(true);
    expect(reachedInterview(app({ title: 'x', status: 'in_process' }))).toBe(true);
    expect(reachedInterview(app({ title: 'x', status: 'rejected', rejectionStage: 'recruiter_screen' }))).toBe(true);
  });
  it('does not count a rejection at the resume review or one with no stage', () => {
    expect(reachedInterview(app({ title: 'x', status: 'rejected', rejectionStage: 'resume_review' }))).toBe(false);
    expect(reachedInterview(app({ title: 'x', status: 'rejected', rejectionStage: 'unknown' }))).toBe(false);
    expect(reachedInterview(app({ title: 'x', status: 'acknowledged' }))).toBe(false);
  });
});

describe('titleLevel', () => {
  it('reads the level from the title words', () => {
    expect(titleLevel('Associate, Strategic Finance')).toBe('entry');
    expect(titleLevel('Senior Financial Analyst')).toBe('mid');
    expect(titleLevel('FP&A Manager')).toBe('mid');
    expect(titleLevel('Senior Manager, Strategic Finance')).toBe('senior');
    expect(titleLevel('Head of Strategy')).toBe('senior');
    expect(titleLevel('Director of FP&A')).toBe('executive');
    expect(titleLevel('Strategic Finance')).toBe('mid');
  });
});

describe('isSimilarTitle', () => {
  it('matches the same work across spellings and near levels', () => {
    expect(workStems('Strategic Finance Associate')).toEqual(new Set(['strate', 'financ']));
    expect(isSimilarTitle('Strategic Finance Associate', 'Senior Financial Analyst')).toBe(true);
    expect(isSimilarTitle('Strategy & Operations Manager', 'Strategic Finance Associate')).toBe(true);
  });
  it('keeps different work and distant levels apart', () => {
    expect(isSimilarTitle('Strategic Finance Associate', 'Software Engineer')).toBe(false);
    expect(isSimilarTitle('Financial Analyst', 'Director of Finance')).toBe(false);
  });
});

describe('summariseHistory', () => {
  const history: PastApplication[] = [
    app({ title: 'Financial Analyst', company: 'Brex', status: 'acknowledged' }),
    app({ title: 'Strategic Finance Associate', company: 'Ramp', status: 'rejected', rejectionStage: 'resume_review' }),
    app({ title: 'Senior Financial Analyst', company: 'Stripe', status: 'ghosted', hasInterview: true }),
    app({ title: 'Software Engineer', company: 'Plaid', status: 'rejected', rejectionStage: 'hiring_manager' }),
    app({ title: 'FP&A Analyst', company: 'Mercury', status: 'lead' }),
  ];

  it('counts the similar ones and the whole record, leaving out what was never sent', () => {
    const summary = summariseHistory('Finance Associate', history);
    expect(summary.similar).toMatchObject({ applied: 3, reached_an_interview: 1, still_waiting: 1 });
    expect(summary.all_applications).toEqual({ applied: 4, reached_an_interview: 2, still_waiting: 1 });
  });

  it('names the ones that reached an interview first', () => {
    expect(summariseHistory('Finance Associate', history).similar.examples).toEqual([
      'Senior Financial Analyst at Stripe: reached an interview',
      'Financial Analyst at Brex: no reply yet',
      'Strategic Finance Associate at Ramp: rejected at resume review',
    ]);
  });

  it('leaves out the application being scored', () => {
    const own = history[0]!;
    const summary = summariseHistory(own.title, history, { excludeId: own.id });
    expect(summary.similar.applied).toBe(2);
    expect(summary.all_applications.applied).toBe(3);
  });

  it('names at most a dozen', () => {
    const many = Array.from({ length: 20 }, () => app({ title: 'Financial Analyst' }));
    const summary = summariseHistory('Financial Analyst', many);
    expect(summary.similar.applied).toBe(20);
    expect(summary.similar.examples).toHaveLength(HISTORY_EXAMPLES);
  });
});

describe('channelOf', () => {
  it('reads a sent LinkedIn application as Easy Apply and a LinkedIn lead as direct', () => {
    expect(channelOf({ status: 'ghosted', source: 'linkedin' })).toBe('easy_apply');
    expect(channelOf({ status: 'lead', source: 'linkedin' })).toBe('direct');
    expect(channelOf({ status: 'submitted', source: 'portal' })).toBe('direct');
    expect(channelOf({ status: 'submitted' })).toBe('direct');
  });
});

describe('summariseHistory by channel', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const history: PastApplication[] = [
    ...Array.from({ length: 10 }, () =>
      app({ title: 'Financial Analyst', source: 'linkedin', sentAt: '2026-10-02T00:00:00Z' }),
    ),
    app({ title: 'Financial Analyst', source: 'portal', hasInterview: true, sentAt: '2026-09-10T00:00:00Z' }),
    app({ title: 'Financial Analyst', source: 'portal', sentAt: '2026-09-12T00:00:00Z' }),
    app({ title: 'Financial Analyst', source: 'portal', status: 'submitted', sentAt: '2026-10-20T00:00:00Z' }),
    app({ title: 'Financial Analyst', source: 'portal', sentAt: '2026-03-01T00:00:00Z' }),
  ];

  it('compares a direct application with the direct ones only', () => {
    const summary = summariseHistory('Financial Analyst', history, { now });
    expect(summary.channel).toBe('direct');
    expect(summary.all_applications).toEqual({ applied: 4, reached_an_interview: 1, still_waiting: 1 });
    expect(summary.other_channel).toEqual({ channel: 'easy_apply', applied: 10, reached_an_interview: 0, still_waiting: 0 });
  });

  it('compares an Easy Apply one with Easy Apply', () => {
    const summary = summariseHistory('Financial Analyst', history, { now, channel: 'easy_apply' });
    expect(summary.all_applications.applied).toBe(10);
    expect(summary.other_channel.applied).toBe(4);
  });

  it('counts the last four months by when each went in', () => {
    expect(recentMonths(now)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    const months = summariseHistory('Financial Analyst', history, { now }).by_month;
    expect(months.map((m) => [m.month, m.applied, m.reached_an_interview, m.still_waiting])).toEqual([
      ['2026-07', 0, 0, 0],
      ['2026-08', 0, 0, 0],
      ['2026-09', 2, 1, 0],
      ['2026-10', 1, 0, 1],
    ]);
  });
});

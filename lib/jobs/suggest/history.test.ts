import { describe, expect, it } from 'vitest';
import {
  HISTORY_EXAMPLES,
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

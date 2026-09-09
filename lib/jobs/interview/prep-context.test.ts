import { describe, expect, it } from 'vitest';
import { MAX_SHORTLIST, type ShortlistItem } from '../evidence/shortlist';
import type { RequirementMatch } from '../evidence/match-payload';
import type { Requirement } from '../jd/requirements';
import {
  MAX_JD_EXCERPT_CHARS,
  MAX_PRIOR_QUESTIONS,
  MAX_PRIOR_ROUNDS,
  buildPrepContext,
  type PrepConversationRow,
  type PrepInput,
  type PrepPriorRoundRow,
} from './prep-context';

function contact(id: string, overrides: Partial<{ fullName: string; title: string | null }> = {}) {
  return {
    id,
    fullName: overrides.fullName ?? `Person ${id}`,
    title: overrides.title ?? null,
    relationship: null,
    howWeConnect: null,
    notes: null,
    linkedinUrl: null,
  };
}

function conversation(
  id: string,
  overrides: Partial<PrepConversationRow> = {},
): PrepConversationRow {
  return {
    id,
    kind: 'hiring_manager',
    scheduledAt: '2026-03-02T14:00:00Z',
    timeKnown: true,
    durationMinutes: 45,
    format: 'video',
    participants: [],
    ...overrides,
  };
}

function priorRound(id: string, overrides: Partial<PrepPriorRoundRow> = {}): PrepPriorRoundRow {
  return {
    id,
    roleTitle: 'Senior Analyst',
    kind: 'recruiter_screen',
    scheduledAt: '2026-01-05T10:00:00Z',
    questionsAsked: [],
    notes: null,
    ...overrides,
  };
}

function bankItem(id: string, overrides: Partial<ShortlistItem> = {}): ShortlistItem {
  return {
    id,
    title: `Story ${id}`,
    body: 'Something that happened at work.',
    context: null,
    metrics: null,
    skills: [],
    strength: 3,
    ...overrides,
  };
}

const must = (text: string): Requirement => ({ text, kind: 'must_have' });

function input(overrides: Partial<PrepInput> = {}): PrepInput {
  return {
    conversations: [conversation('c1', { participants: [{ role: 'interviewer', contact: contact('p1') }] })],
    round: null,
    role: {
      title: 'Senior Analyst',
      seniority: 'senior',
      location: 'London',
      workMode: 'hybrid',
      jdText: 'We are looking for someone who can build forecasting models.',
      requirements: [must('Forecasting models')],
      requirementMatches: [
        {
          requirement: 'Forecasting models',
          kind: 'must_have',
          verdict: 'strong',
          evidenceItemId: 'e1',
          why: 'Six years of it.',
        },
      ],
      ...overrides.role,
    },
    company: {
      name: 'Acme',
      industry: 'Insurance',
      stage: 'series-b',
      headcountBand: '50-200',
      research: 'Founded 2019, growing fast.',
      priority: 'high',
      ...overrides.company,
    },
    priorRounds: [priorRound('old1', { questionsAsked: ['Why us?'] })],
    bank: [bankItem('e1', { title: 'Forecasting rebuild', skills: ['forecasting'] })],
    profile: { targetTitles: ['Analyst'], timezone: 'Europe/London', writingStyleNotes: null },
    ...overrides,
  };
}

describe('buildPrepContext', () => {
  it('carries the round, the role, the company, the people and the bank', () => {
    const context = buildPrepContext(input());

    expect(context.round.conversations).toHaveLength(1);
    expect(context.round.startsAt).toBe('2026-03-02T14:00:00Z');
    expect(context.role.title).toBe('Senior Analyst');
    expect(context.role.requirements).toHaveLength(1);
    expect(context.role.matches).toHaveLength(1);
    expect(context.company.name).toBe('Acme');
    expect(context.interviewers.map((person) => person.contactId)).toEqual(['p1']);
    expect(context.priorRounds.map((round) => round.id)).toEqual(['old1']);
    expect(context.bank.map((item) => item.id)).toEqual(['e1']);
    expect(context.missing).toEqual([]);
  });

  it('labels the kind rather than leaving the enum on the page', () => {
    const context = buildPrepContext(
      input({ conversations: [conversation('c1', { kind: 'recruiter_screen' })] }),
    );
    expect(context.round.conversations[0].kindLabel).toBe('Recruiter screen');
    expect(context.priorRounds[0].kindLabel).toBe('Recruiter screen');
  });

  it('names an unpeopled round as missing its participants', () => {
    const context = buildPrepContext(
      input({ conversations: [conversation('c1', { participants: [] })] }),
    );

    expect(context.interviewers).toEqual([]);
    expect(context.missing).toContain('participants');
    expect(context.round.conversations[0].interviewerNames).toEqual([]);
  });

  it('still writes from the company and the bank when there is no description', () => {
    const context = buildPrepContext(
      input({
        role: {
          title: 'Senior Analyst',
          seniority: null,
          location: null,
          workMode: null,
          jdText: null,
          requirements: null,
          requirementMatches: null,
        },
      }),
    );

    expect(context.role.jdExcerpt).toBeNull();
    expect(context.role.requirements).toEqual([]);
    expect(context.missing).toContain('jd');
    expect(context.missing).toContain('requirements');
    expect(context.missing).toContain('requirement_matches');
    // The bank is the only material left, so it survives rather than being
    // shortlisted against nothing and coming back empty.
    expect(context.bank.map((item) => item.id)).toEqual(['e1']);
    expect(context.missing).not.toContain('bank');
  });

  it('names a company with no earlier rounds', () => {
    const context = buildPrepContext(input({ priorRounds: [] }));
    expect(context.priorRounds).toEqual([]);
    expect(context.missing).toContain('prior_rounds');
  });

  it('names an empty bank without throwing', () => {
    const context = buildPrepContext(input({ bank: [] }));
    expect(context.bank).toEqual([]);
    expect(context.missing).toContain('bank');
  });

  it('names company research that was never written', () => {
    const context = buildPrepContext(
      input({
        company: {
          name: 'Acme',
          industry: null,
          stage: null,
          headcountBand: null,
          research: '   ',
          priority: 'normal',
        },
      }),
    );
    expect(context.company.research).toBeNull();
    expect(context.missing).toContain('company_research');
  });

  it('reads a superday as one round of four conversations', () => {
    const shared = contact('hm', { fullName: 'Dana Hill' });
    const context = buildPrepContext(
      input({
        round: { label: 'Onsite', roundNumber: 3, notes: 'A long afternoon.' },
        conversations: [
          conversation('c4', {
            scheduledAt: '2026-03-02T17:00:00Z',
            participants: [{ role: 'interviewer', contact: shared }],
          }),
          conversation('c1', {
            scheduledAt: '2026-03-02T14:00:00Z',
            participants: [{ role: 'interviewer', contact: shared }],
          }),
          conversation('c2', {
            scheduledAt: '2026-03-02T15:00:00Z',
            participants: [{ role: 'interviewer', contact: contact('b') }],
          }),
          conversation('c3', { scheduledAt: '2026-03-02T16:00:00Z', participants: [] }),
        ],
      }),
    );

    expect(context.round.conversations.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(context.round.startsAt).toBe('2026-03-02T14:00:00Z');
    expect(context.round.label).toBe('Onsite');
    expect(context.round.roundNumber).toBe(3);
    // The person in two conversations is introduced once, and both are named.
    const dana = context.interviewers.find((person) => person.contactId === 'hm');
    expect(dana?.conversationIds).toEqual(['c1', 'c4']);
    expect(context.interviewers).toHaveLength(2);
    expect(context.missing).not.toContain('participants');
  });

  it('sorts a conversation with no time after the ones that have one', () => {
    const context = buildPrepContext(
      input({
        conversations: [
          conversation('unscheduled', { scheduledAt: null, timeKnown: false }),
          conversation('booked', { scheduledAt: '2026-03-02T14:00:00Z' }),
        ],
      }),
    );
    expect(context.round.conversations.map((c) => c.id)).toEqual(['booked', 'unscheduled']);
    expect(context.round.startsAt).toBe('2026-03-02T14:00:00Z');
  });

  it('keeps the most recent earlier rounds and drops the rest', () => {
    const rounds = Array.from({ length: MAX_PRIOR_ROUNDS + 3 }, (_, index) =>
      priorRound(`r${index}`, { scheduledAt: `2026-0${index + 1}-01T10:00:00Z` }),
    );
    const context = buildPrepContext(input({ priorRounds: rounds }));

    expect(context.priorRounds).toHaveLength(MAX_PRIOR_ROUNDS);
    expect(context.priorRounds[0].id).toBe(`r${MAX_PRIOR_ROUNDS + 2}`);
  });

  it('does not quote the round back to itself', () => {
    const context = buildPrepContext(
      input({
        conversations: [conversation('c1')],
        priorRounds: [priorRound('c1'), priorRound('old1')],
      }),
    );
    expect(context.priorRounds.map((round) => round.id)).toEqual(['old1']);
  });

  it('spends the question budget on the most recent rounds', () => {
    const many = Array.from({ length: 40 }, (_, index) => `Question ${index}`);
    const context = buildPrepContext(
      input({
        priorRounds: [
          priorRound('recent', { scheduledAt: '2026-02-01T10:00:00Z', questionsAsked: many }),
          priorRound('older', { scheduledAt: '2026-01-01T10:00:00Z', questionsAsked: many }),
        ],
      }),
    );

    const total = context.priorRounds.reduce(
      (sum, round) => sum + round.questionsAsked.length,
      0,
    );
    expect(total).toBe(MAX_PRIOR_QUESTIONS);
    expect(context.priorRounds[0].id).toBe('recent');
    expect(context.priorRounds[0].questionsAsked).toHaveLength(MAX_PRIOR_QUESTIONS);
    expect(context.priorRounds[1].questionsAsked).toEqual([]);
  });

  it('cuts the description short once requirements stand in for it', () => {
    const long = `${'Paragraph about the role. '.repeat(400)}`;
    const withRequirements = buildPrepContext(input({ role: { ...input().role, jdText: long } }));
    expect(withRequirements.role.jdExcerpt!.length).toBeLessThanOrEqual(MAX_JD_EXCERPT_CHARS);
    expect(withRequirements.role.jdTruncated).toBe(true);

    const withoutRequirements = buildPrepContext(
      input({ role: { ...input().role, jdText: long, requirements: [], requirementMatches: [] } }),
    );
    expect(withoutRequirements.role.jdExcerpt!.length).toBeGreaterThan(MAX_JD_EXCERPT_CHARS);
    expect(withoutRequirements.role.jdTruncated).toBe(false);
  });

  it('bounds the bank however large it grows', () => {
    const bank = Array.from({ length: MAX_SHORTLIST + 20 }, (_, index) =>
      bankItem(`e${index}`, { title: 'Forecasting rebuild', skills: ['forecasting'] }),
    );
    const context = buildPrepContext(input({ bank }));
    expect(context.bank.length).toBeLessThanOrEqual(MAX_SHORTLIST);
  });

  it('keeps an item the requirement map cites even when the shortlist would drop it', () => {
    const cited = bankItem('cited', { title: 'Ran the office move', body: 'Logistics.' });
    const bank = [
      cited,
      ...Array.from({ length: MAX_SHORTLIST + 10 }, (_, index) =>
        bankItem(`e${index}`, { title: 'Forecasting rebuild', skills: ['forecasting'], strength: 5 }),
      ),
    ];
    const matches: RequirementMatch[] = [
      {
        requirement: 'Forecasting models',
        kind: 'must_have',
        verdict: 'partial',
        evidenceItemId: 'cited',
        why: 'Adjacent.',
      },
    ];
    const context = buildPrepContext(
      input({ bank, role: { ...input().role, requirementMatches: matches } }),
    );

    expect(context.bank.map((item) => item.id)).toContain('cited');
    expect(context.bank.length).toBeLessThanOrEqual(MAX_SHORTLIST);
  });

  it('survives a round with nothing on it at all', () => {
    const context = buildPrepContext({
      conversations: [],
      round: null,
      role: {
        title: 'Analyst',
        seniority: null,
        location: null,
        workMode: null,
        jdText: null,
        requirements: null,
        requirementMatches: null,
      },
      company: {
        name: 'Acme',
        industry: null,
        stage: null,
        headcountBand: null,
        research: null,
        priority: null,
      },
      priorRounds: [],
      bank: [],
      profile: { targetTitles: [], timezone: 'UTC', writingStyleNotes: null },
    });

    expect(context.round.conversations).toEqual([]);
    expect(context.round.startsAt).toBeNull();
    expect(context.missing).toEqual([
      'jd',
      'requirements',
      'requirement_matches',
      'participants',
      'prior_rounds',
      'company_research',
      'bank',
    ]);
  });
});

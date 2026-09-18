import { describe, expect, it } from 'vitest';
import type { RequirementMatch } from '../evidence/match-payload';
import type { ShortlistItem } from '../evidence/shortlist';
import type { Requirement } from '../jd/requirements';
import {
  buildPrepContext,
  type PrepContext,
  type PrepConversationRow,
  type PrepInput,
  type PrepPriorRoundRow,
} from './prep-context';
import { MAX_NOTE_PRIOR_QUESTIONS, parsePrepPayload, prepKey } from './prep-payload';

function contact(id: string) {
  return {
    id,
    fullName: `Person ${id}`,
    title: 'Head of Finance',
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
    participants: [{ role: 'interviewer', contact: contact('p1') }],
    ...overrides,
  };
}

function bankItem(id: string): ShortlistItem {
  return {
    id,
    title: `Story ${id}`,
    body: 'Something that happened at work, involving forecasting.',
    context: null,
    metrics: null,
    skills: [],
    strength: 3,
  };
}

const must = (text: string): Requirement => ({ text, kind: 'must_have' });

const match = (
  requirement: string,
  verdict: RequirementMatch['verdict'],
  evidenceItemId: string | null,
): RequirementMatch => ({
  requirement,
  kind: 'must_have',
  verdict,
  evidenceItemId,
  why: 'Because of the record.',
});

/** A round with everything on file, so a test can take one thing away. */
function context(overrides: Partial<PrepInput> = {}): PrepContext {
  const base: PrepInput = {
    conversations: [conversation('c1')],
    round: null,
    role: {
      title: 'Senior Analyst',
      seniority: 'senior',
      location: 'London',
      workMode: 'hybrid',
      jdText: 'We are looking for someone who can build forecasting models.',
      requirements: [must('Forecasting models'), must('Insurance experience')],
      requirementMatches: [
        match('Forecasting models', 'strong', 'e1'),
        match('Insurance experience', 'gap', null),
      ],
    },
    company: {
      name: 'Northwind',
      industry: 'insurance',
      stage: 'series_b',
      headcountBand: '51-200',
      research: 'They raised in January.',
      priority: 'high',
    },
    priorRounds: [
      {
        id: 'old-1',
        roleTitle: 'Analyst',
        kind: 'recruiter_screen',
        scheduledAt: '2026-01-05T10:00:00Z',
        questionsAsked: ['Why insurance?', 'Walk me through a forecast you owned.'],
        notes: null,
      } satisfies PrepPriorRoundRow,
    ],
    bank: [bankItem('e1'), bankItem('e2')],
    profile: { targetTitles: ['Senior Analyst'], timezone: 'Europe/London', writingStyleNotes: null },
  };
  return buildPrepContext({ ...base, ...overrides });
}

/** A well-formed response, for a test to spoil one field of. */
const wellFormed = {
  round_summary: 'A 45-minute call with the hiring manager on 2 March.',
  interviewers: [{ contact_id: 'p1', note: 'Runs the finance team.' }],
  points: [
    { requirement_index: 0, note: 'Lead with the reforecast.' },
    { requirement_index: 1, note: 'Say plainly you have not worked in insurance.' },
  ],
  stories: [{ evidence_item_id: 'e1', note: 'For anything about owning a number.' }],
  prior_rounds_note: 'The screen cared about why insurance.',
  questions_to_ask: ['Who owns the forecast today?'],
  missing: [],
};

describe('parsePrepPayload', () => {
  it('keeps a note that stays inside what it was given', () => {
    const result = parsePrepPayload(wellFormed, context(), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.roundSummary).toBe(wellFormed.round_summary);
    expect(result.note.interviewers).toEqual([
      { contactId: 'p1', name: 'Person p1', note: 'Runs the finance team.' },
    ]);
    expect(result.note.stories).toEqual([
      { evidenceItemId: 'e1', title: 'Story e1', note: 'For anything about owning a number.' },
    ]);
    expect(result.note.questionsToAsk).toEqual(['Who owns the forecast today?']);
    expect(result.note.bannedFound).toEqual([]);
  });

  it('drops a story citing an evidence item that was never offered', () => {
    const result = parsePrepPayload(
      {
        ...wellFormed,
        stories: [
          { evidence_item_id: 'e1', note: 'Real.' },
          { evidence_item_id: 'e-invented', note: 'The time I ran the IPO.' },
        ],
      },
      context(),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.stories.map((story) => story.evidenceItemId)).toEqual(['e1']);
  });

  it('drops a paragraph about somebody who is not on the round', () => {
    const result = parsePrepPayload(
      {
        ...wellFormed,
        interviewers: [
          { contact_id: 'p1', note: 'Runs the finance team.' },
          { contact_id: 'p-invented', note: 'The CFO, who will also be there.' },
        ],
      },
      context(),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.interviewers.map((person) => person.contactId)).toEqual(['p1']);
  });

  it('reports a banned construction found anywhere in the prose', () => {
    const result = parsePrepPayload(
      {
        ...wellFormed,
        questions_to_ask: ['How do you leverage the team?'],
      },
      context(),
      ['leverage', 'passionate about'],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.bannedFound).toEqual(['leverage']);
  });

  it('buckets a point by the verdict on file rather than by what the model called it', () => {
    const result = parsePrepPayload(wellFormed, context(), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.strengths.map((point) => point.requirement)).toEqual([
      'Forecasting models',
    ]);
    expect(result.note.gaps.map((point) => point.requirement)).toEqual(['Insurance experience']);
    expect(result.note.strengths[0].note).toBe('Lead with the reforecast.');
  });

  it('drops a point pointing at a requirement that is not in the map', () => {
    const result = parsePrepPayload(
      { ...wellFormed, points: [{ requirement_index: 99, note: 'About nothing.' }] },
      context(),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.strengths).toEqual([]);
    expect(result.note.gaps).toEqual([]);
  });

  it('carries earlier questions verbatim rather than as the model retyped them', () => {
    const result = parsePrepPayload(wellFormed, context(), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.priorQuestions).toEqual([
      'Why insurance?',
      'Walk me through a forecast you owned.',
    ]);
    expect(result.note.priorRoundsNote).toBe('The screen cared about why insurance.');
  });

  it('caps the earlier questions at what a person will read', () => {
    const questions = Array.from({ length: 20 }, (_, index) => `Question ${index}?`);
    const result = parsePrepPayload(
      wellFormed,
      context({
        priorRounds: [
          {
            id: 'old-1',
            roleTitle: 'Analyst',
            kind: 'recruiter_screen',
            scheduledAt: '2026-01-05T10:00:00Z',
            questionsAsked: questions,
            notes: null,
          },
        ],
      }),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.priorQuestions).toHaveLength(MAX_NOTE_PRIOR_QUESTIONS);
  });

  it('omits the interviewers and names their absence when nobody is on the round', () => {
    const result = parsePrepPayload(
      wellFormed,
      context({ conversations: [conversation('c1', { participants: [] })] }),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.interviewers).toEqual([]);
    expect(result.note.missing).toContain(
      'Nobody is named on this round yet, so who you are meeting is unknown.',
    );
  });

  it('omits the requirement sections and names their absence when there is no description', () => {
    const result = parsePrepPayload(
      wellFormed,
      context({
        role: {
          title: 'Senior Analyst',
          seniority: null,
          location: null,
          workMode: null,
          jdText: null,
          requirements: [],
          requirementMatches: [],
        },
      }),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.strengths).toEqual([]);
    expect(result.note.gaps).toEqual([]);
    expect(result.note.missing).toContain('No job description is on file for this role.');
  });

  it('says nothing about earlier rounds when there were none', () => {
    const result = parsePrepPayload(wellFormed, context({ priorRounds: [] }), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.priorQuestions).toEqual([]);
    expect(result.note.priorRoundsNote).toBeNull();
    expect(result.note.missing).toContain('No earlier rounds at this company are on file.');
  });

  it('keeps what the model noticed was absent, after what the rows already said', () => {
    const result = parsePrepPayload(
      { ...wellFormed, missing: ['No time is set for the second conversation.'] },
      context(),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.missing.at(-1)).toBe('No time is set for the second conversation.');
  });

  it('reports each person, story and question once', () => {
    const result = parsePrepPayload(
      {
        ...wellFormed,
        interviewers: [
          { contact_id: 'p1', note: 'First.' },
          { contact_id: 'p1', note: 'Again.' },
        ],
        stories: [
          { evidence_item_id: 'e1', note: 'First.' },
          { evidence_item_id: 'e1', note: 'Again.' },
        ],
        points: [
          { requirement_index: 0, note: 'First.' },
          { requirement_index: 0, note: 'Again.' },
        ],
        questions_to_ask: ['Who owns the forecast?', 'who owns the forecast?'],
      },
      context(),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.interviewers).toHaveLength(1);
    expect(result.note.interviewers[0].note).toBe('First.');
    expect(result.note.stories).toHaveLength(1);
    expect(result.note.strengths).toHaveLength(1);
    expect(result.note.questionsToAsk).toHaveLength(1);
  });

  it('returns a typed error rather than throwing on a malformed response', () => {
    for (const raw of [null, undefined, 'a note', {}, { round_summary: '   ' }, { round_summary: 7 }]) {
      const result = parsePrepPayload(raw, context(), []);
      expect(result).toEqual({
        ok: false,
        error: 'The prep note came back in an unexpected shape.',
      });
    }
  });

  it('survives a response carrying only the summary', () => {
    const result = parsePrepPayload(
      { round_summary: 'A call on 2 March.' },
      context({ conversations: [conversation('c1', { participants: [] })] }),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.interviewers).toEqual([]);
    expect(result.note.stories).toEqual([]);
    expect(result.note.questionsToAsk).toEqual([]);
    // The rows still say what was not on file, whatever the response left out.
    expect(result.note.missing).toEqual([
      'Nobody is named on this round yet, so who you are meeting is unknown.',
    ]);
  });
});

describe('prepKey', () => {
  const bank = [{ id: 'e1', strength: 4, skills: ['fpna'] }];
  const base = {
    jdHash: 'abc',
    bank,
    conversations: [{ id: 'c1', scheduledAt: '2026-03-02T14:00:00Z' }],
    contactIds: ['p1'],
  };

  it('is stable across order and repeated calls', () => {
    expect(prepKey(base)).toBe(prepKey(base));
    expect(
      prepKey({
        ...base,
        conversations: [
          { id: 'c2', scheduledAt: '2026-03-02T15:00:00Z' },
          { id: 'c1', scheduledAt: '2026-03-02T14:00:00Z' },
        ],
        contactIds: ['p2', 'p1'],
      }),
    ).toBe(
      prepKey({
        ...base,
        conversations: [
          { id: 'c1', scheduledAt: '2026-03-02T14:00:00Z' },
          { id: 'c2', scheduledAt: '2026-03-02T15:00:00Z' },
        ],
        contactIds: ['p1', 'p2'],
      }),
    );
  });

  it('changes when the description, the bank, the schedule or the room changes', () => {
    const current = prepKey(base);
    expect(prepKey({ ...base, jdHash: 'def' })).not.toBe(current);
    expect(prepKey({ ...base, bank: [{ id: 'e1', strength: 5, skills: ['fpna'] }] })).not.toBe(
      current,
    );
    expect(
      prepKey({ ...base, conversations: [{ id: 'c1', scheduledAt: '2026-03-09T14:00:00Z' }] }),
    ).not.toBe(current);
    expect(prepKey({ ...base, contactIds: ['p2'] })).not.toBe(current);
  });

  it('does not treat an unscheduled round as a scheduled one', () => {
    expect(prepKey({ ...base, conversations: [{ id: 'c1', scheduledAt: null }] })).not.toBe(
      prepKey(base),
    );
  });
});

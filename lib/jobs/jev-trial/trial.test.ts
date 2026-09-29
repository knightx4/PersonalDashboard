import { describe, expect, it } from 'vitest';
import {
  decidedBy,
  handLabelFor,
  onJevFailure,
  pickTrialSample,
  summariseTrial,
  type LedgerRow,
  type TrialAnswer,
} from './trial';

function ledger(id: string, classification: string, extra: Partial<LedgerRow> = {}): LedgerRow {
  return { id, classification, parse_confidence: null, error: null, ...extra };
}

function answer(extra: Partial<TrialAnswer>): TrialAnswer {
  return {
    message_id: 'm',
    stored_label: 'rejection',
    stored_confidence: 0.9,
    hand_label: null,
    tier_a_label: 'rejection',
    tier_a_tier: 'none',
    jev_label: 'rejection',
    jev_confidence: 0.95,
    failure: null,
    ...extra,
  };
}

describe('pickTrialSample', () => {
  const rows = [
    ledger('a', 'rejection'),
    ledger('b', 'job_alert'),
    ledger('c', 'not_relevant', { parse_confidence: 0.7 }),
    ledger('d', 'not_relevant', { error: 'Dismissed: you said this was not a real pursuit.' }),
    ...Array.from({ length: 10 }, (_, i) => ledger(`n${i}`, 'not_relevant')),
  ];

  it('keeps every labelled, Haiku-read and hand-relabelled message', () => {
    const ids = pickTrialSample(rows, { notRelevantSample: 0 }).map((r) => r.id);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('adds a fixed number of the other not-relevant mail, the same ones every run', () => {
    const first = pickTrialSample(rows, { notRelevantSample: 3 });
    const second = pickTrialSample([...rows].reverse(), { notRelevantSample: 3 });
    expect(first).toHaveLength(7);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });
});

describe('handLabelFor', () => {
  it('reads the pipeline dismissal as not relevant and nothing else', () => {
    expect(handLabelFor({ error: 'Dismissed: you said this was not a real pursuit.' })).toBe('not_relevant');
    expect(handLabelFor({ error: 'Unlinked by hand from the role page.' })).toBeNull();
    expect(handLabelFor({ error: null })).toBeNull();
  });
});

describe('onJevFailure', () => {
  it('stops on a missing or refused key', () => {
    expect(onJevFailure({ reason: 'no-key', detail: '' })).toBe('stop');
    expect(onJevFailure({ reason: 'refused', detail: '401: bad key' })).toBe('stop');
    expect(onJevFailure({ reason: 'refused', detail: '403' })).toBe('stop');
  });

  it('stores a refusal about one message and an unreadable answer', () => {
    expect(onJevFailure({ reason: 'refused', detail: '422: too long' })).toBe('store');
    expect(onJevFailure({ reason: 'malformed', detail: 'x' })).toBe('store');
  });

  it('retries what may pass', () => {
    for (const reason of ['rate-limited', 'overloaded', 'timeout', 'error']) {
      expect(onJevFailure({ reason, detail: '' })).toBe('retry');
    }
  });
});

describe('decidedBy', () => {
  it('credits the rules when Tier A is sure of the stored label', () => {
    expect(decidedBy(answer({ tier_a_tier: 'A', tier_a_label: 'rejection' }))).toBe('rules');
  });

  it('credits Haiku when it read the message and the rules were not sure', () => {
    expect(decidedBy(answer({ tier_a_tier: 'none' }))).toBe('haiku');
    // The rejection override: Tier A said confirmation, Haiku's rejection stood.
    expect(
      decidedBy(answer({ tier_a_tier: 'A', tier_a_label: 'application_confirmation' })),
    ).toBe('haiku');
  });

  it('credits the rules when no model read it', () => {
    expect(decidedBy(answer({ stored_confidence: null, tier_a_tier: 'none' }))).toBe('rules');
  });
});

describe('summariseTrial', () => {
  const rows = [
    answer({ message_id: '1' }),
    answer({ message_id: '2', jev_label: 'application_confirmation', jev_confidence: 0.9 }),
    answer({ message_id: '3', jev_confidence: 0.5 }),
    answer({
      message_id: '4',
      stored_label: 'application_confirmation',
      tier_a_label: 'application_confirmation',
      tier_a_tier: 'A',
      jev_label: 'application_confirmation',
      jev_confidence: '0.99',
    }),
    answer({
      message_id: '5',
      stored_label: 'interview_invite',
      hand_label: 'not_relevant',
      jev_label: 'not_relevant',
      jev_confidence: 0.6,
    }),
    answer({ message_id: '6', jev_label: null, jev_confidence: null, failure: 'malformed: x' }),
  ];
  const summary = summariseTrial(rows);

  it('counts agreement overall and per stored label', () => {
    expect(summary.answered).toBe(5);
    expect(summary.agree).toBe(3);
    expect(summary.failed).toEqual({ 'malformed: x': 1 });
    const rejection = summary.byLabel.find((l) => l.label === 'rejection')!;
    expect(rejection).toMatchObject({ messages: 3, agree: 2, unsure: 1, sureMessages: 2, sureAgree: 1 });
    expect(summary.byLabel[0]!.label).toBe('rejection');
  });

  it('counts what Jev would keep at the floor', () => {
    expect(summary.unsure).toBe(2);
    expect(summary.sureMessages).toBe(3);
    expect(summary.sureAgree).toBe(2);
  });

  it('splits by who settled the stored label', () => {
    expect(summary.byDecider.rules).toMatchObject({ messages: 1, agree: 1 });
    expect(summary.byDecider.haiku).toMatchObject({ messages: 4, agree: 2 });
  });

  it('scores both against the hand labels', () => {
    expect(summary.hand).toEqual({ messages: 1, jevRight: 1, storedRight: 0 });
  });

  it('lists the disagreements, surest first', () => {
    expect(summary.disagreements.map((d) => d.message_id)).toEqual(['2', '5']);
    expect(summary.disagreements[1]).toMatchObject({ stored: 'interview_invite', jev: 'not_relevant', hand: 'not_relevant' });
  });
});

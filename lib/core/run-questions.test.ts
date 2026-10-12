import { describe, expect, it } from 'vitest';
import type { RunActivity, RunActivityKind } from './run-activities';
import {
  RUN_ANSWER_MAX,
  alreadyAnswered,
  answerFrom,
  answerToLatest,
  choiceKey,
  continuationText,
  openQuestion,
  sessionHasLeft,
} from './run-questions';

let next = 0;
function line(kind: RunActivityKind, body: string, options: string[] | null = null): RunActivity {
  next += 1;
  return {
    id: `l${next}`,
    user_id: 'u',
    run_table: 'plan_runs',
    run_id: 'r',
    kind,
    body,
    options,
    created_at: new Date(Date.UTC(2026, 9, 12, 9, next)).toISOString(),
  };
}

describe('the question a run is waiting on', () => {
  it('is the newest question with nothing answered after it', () => {
    const asked = line('question', 'Stay or close?', ['Stay', 'Close']);
    expect(openQuestion([line('action', 'Claimed'), asked])).toBe(asked);
    expect(openQuestion([asked, line('thought', 'Reading meanwhile')])).toBe(asked);
    expect(alreadyAnswered([asked])).toBe(false);
  });

  it('is gone once a response follows it', () => {
    const lines = [line('question', 'Stay or close?'), line('response', 'Stay')];
    expect(openQuestion(lines)).toBeNull();
    expect(alreadyAnswered(lines)).toBe(true);
  });

  it('is none on a run that asked nothing', () => {
    const lines = [line('action', 'Claimed')];
    expect(openQuestion(lines)).toBeNull();
    expect(alreadyAnswered(lines)).toBe(false);
  });

  it('is the second question once the first is answered', () => {
    const second = line('question', 'And the badge?');
    expect(openQuestion([line('question', 'First?'), line('response', 'Yes'), second])).toBe(second);
  });
});

describe('the answer a session reads back', () => {
  it('is the first response after the newest question', () => {
    const question = line('question', 'Stay or close?');
    const answer = line('response', 'Stay until I acknowledge it.');
    expect(answerToLatest([question, answer, line('action', 'Kept it')])).toEqual({ question, answer });
  });

  it('is none before the answer, and none for an earlier question', () => {
    expect(answerToLatest([line('question', 'Stay?')])).toBeNull();
    expect(answerToLatest([line('question', 'A?'), line('response', 'Yes'), line('question', 'B?')])).toBeNull();
  });
});

describe('an answer', () => {
  it('is trimmed, and refused when empty or too long', () => {
    expect(answerFrom('  Stay  ')).toEqual({ answer: 'Stay' });
    expect(answerFrom('   ')).toHaveProperty('refusal');
    expect(answerFrom(null)).toHaveProperty('refusal');
    expect(answerFrom('x'.repeat(RUN_ANSWER_MAX + 1))).toHaveProperty('refusal');
  });

  it('matches its choice as words', () => {
    expect(choiceKey('Stay until I acknowledge it.')).toBe(choiceKey('stay until i acknowledge it'));
  });
});

describe('whether the session has left', () => {
  it('reads stopped_at on a plan run and ended_at on a goal run', () => {
    expect(sessionHasLeft('plan_runs', { stopped_at: null })).toBe(false);
    expect(sessionHasLeft('plan_runs', { stopped_at: '2026-10-12T10:00:00Z' })).toBe(true);
    expect(sessionHasLeft('goals.runs', { ended_at: null })).toBe(false);
    expect(sessionHasLeft('goals.runs', { ended_at: '2026-10-12T10:00:00Z' })).toBe(true);
  });
});

describe('the brief a continued run opens with', () => {
  it('carries the question, the answer and the lines so far', () => {
    const text = continuationText({
      runId: 'r1',
      question: 'Stay or close?',
      answer: 'Stay',
      lines: [line('action', 'Claimed #1824'), line('question', 'Stay or close?')],
    });
    expect(text).toContain('Asked: Stay or close?');
    expect(text).toContain('Answered: Stay');
    expect(text).toContain('- Did: Claimed #1824');
    expect(text).toContain('(r1)');
  });

  it('keeps the newest forty lines of a long run', () => {
    const lines = Array.from({ length: 45 }, (_, index) => line('thought', `Line ${index}`));
    const text = continuationText({ runId: 'r', question: 'Q?', answer: 'A', lines });
    expect(text).toContain('(5 earlier lines left out.)');
    expect(text).not.toContain('Line 4\n');
    expect(text).toContain('Line 44');
  });
});

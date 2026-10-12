import { describe, expect, it } from 'vitest';
import { RUN_LINE_MAX, runLine, runResponse, statusAfterLine } from './run-line';

describe('runLine', () => {
  it('accepts an action', () => {
    expect(runLine('action', ' Claimed #5 ', [])).toEqual({
      line: { kind: 'action', body: 'Claimed #5', options: null },
    });
  });

  it('refuses a response, which is the person\'s', () => {
    expect(runLine('response', 'ok', [])).toHaveProperty('refusal');
  });

  it('refuses a blank or long body', () => {
    expect(runLine('thought', '  ', [])).toHaveProperty('refusal');
    expect(runLine('thought', 'x'.repeat(RUN_LINE_MAX + 1), [])).toHaveProperty('refusal');
  });

  it('keeps options for a question only', () => {
    expect(runLine('question', 'Which?', ['a', 'b'])).toEqual({
      line: { kind: 'question', body: 'Which?', options: ['a', 'b'] },
    });
    expect(runLine('error', 'broke', ['a'])).toHaveProperty('refusal');
    expect(runLine('question', 'Which?', new Array(11).fill('a'))).toHaveProperty('refusal');
  });
});

describe('statusAfterLine', () => {
  it('parks a question and wakes any other line', () => {
    expect(statusAfterLine('started', 'question')).toBe('awaiting_input');
    expect(statusAfterLine('stale', 'action')).toBe('started');
    expect(statusAfterLine('awaiting_input', 'thought')).toBe('started');
  });

  it('leaves an ended run alone', () => {
    expect(statusAfterLine('finished', 'action')).toBe('finished');
    expect(statusAfterLine('failed', 'question')).toBe('failed');
  });
});

describe('runResponse', () => {
  it('prints the answer to the newest question', () => {
    const said = runResponse([
      { kind: 'question', body: 'Stay or close?' },
      { kind: 'response', body: 'Stay' },
    ]);
    expect(said).toContain('Answered: Stay');
    expect(said).toContain('Stay or close?');
  });

  it('says there is no answer yet, and how to stop if nothing is left', () => {
    const said = runResponse([
      { kind: 'question', body: 'A?' },
      { kind: 'response', body: 'Yes' },
      { kind: 'question', body: 'B?' },
    ]);
    expect(said).toMatch(/^No answer yet to: B\?/);
    expect(said).toContain('stopped <n>');
  });

  it('says when nothing was asked', () => {
    expect(runResponse([{ kind: 'action', body: 'Claimed' }])).toBe('This run has asked nothing.');
  });
});

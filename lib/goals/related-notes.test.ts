import { describe, expect, it } from 'vitest';
import { goalMatchText } from './related-notes';

describe('goalMatchText', () => {
  it('is the title and the done-when', () => {
    expect(goalMatchText({ title: 'Run a marathon', acceptance: 'Finish one under four hours' })).toBe(
      'Run a marathon\nFinish one under four hours',
    );
  });

  it('is the title alone without a done-when', () => {
    expect(goalMatchText({ title: ' Learn Spanish ', acceptance: null })).toBe('Learn Spanish');
  });
});

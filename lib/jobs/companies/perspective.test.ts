import { describe, expect, it } from 'vitest';
import { answeredCount, PERSPECTIVE_COLUMNS, perspectiveOf } from './perspective';

describe('company perspective', () => {
  it('reads the six answers off a row, blank where there is none', () => {
    const perspective = perspectiveOf({
      perspective_business: 'Payments for clinics.',
      perspective_why_now: null,
      perspective_next_move: '  ',
    });
    expect(perspective.business).toBe('Payments for clinics.');
    expect(perspective.whyNow).toBe('');
    expect(perspective.problem).toBe('');
  });

  it('counts only answers with words in them', () => {
    const perspective = perspectiveOf({
      perspective_business: 'Payments for clinics.',
      perspective_why_me: 'Revenue audits at Halvorsen & Co.',
      perspective_next_move: '  ',
    });
    expect(answeredCount(perspective)).toBe(2);
  });

  it('selects every perspective column and when one last changed', () => {
    expect(PERSPECTIVE_COLUMNS.split(', ')).toHaveLength(7);
    expect(PERSPECTIVE_COLUMNS).toContain('perspective_updated_at');
  });
});

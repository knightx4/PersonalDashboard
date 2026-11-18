import { describe, expect, it } from 'vitest';
import { speechReportLine } from './report-line';

describe('speechReportLine (plan #3068)', () => {
  it('keeps the known fields, short, and the browser', () => {
    const line = speechReportLine(
      { stage: 'play', name: 'StalledError', message: 'x'.repeat(500), status: 429, contextStalled: true, context: null, extra: 'dropped', nested: { a: 1 } },
      'iPhone Safari',
    );
    expect(line).toEqual({
      stage: 'play',
      name: 'StalledError',
      message: 'x'.repeat(300),
      status: 429,
      contextStalled: true,
      context: null,
      agent: 'iPhone Safari',
    });
  });

  it('refuses anything that is not an object', () => {
    expect(speechReportLine(null, null)).toBeNull();
    expect(speechReportLine(['a'], null)).toBeNull();
    expect(speechReportLine('play', null)).toBeNull();
  });
});

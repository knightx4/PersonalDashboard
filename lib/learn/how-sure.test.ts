import { describe, expect, it } from 'vitest';
import { HOW_SURE, howSureChoice, rowHowSure } from './how-sure';
import { evidenceConfidence } from './levels/store';
import { howSureLine } from '@/components/learn/how-sure';

describe('how sure (plan #2522.2)', () => {
  it('stores the four choices as 0.25, 0.5, 0.75 and 0.95', () => {
    expect(HOW_SURE.map((c) => [c.label, c.value])).toEqual([
      ['Guessing', 0.25],
      ['Unsure', 0.5],
      ['Fairly sure', 0.75],
      ['Certain', 0.95],
    ]);
  });

  it('reads a stored numeric, which can arrive as text', () => {
    expect(rowHowSure({ confidence: '0.50', reasoning: null })).toEqual({ confidence: 0.5, reasoning: null });
    expect(rowHowSure({})).toEqual({ confidence: null, reasoning: null });
    expect(rowHowSure({ confidence: 0.75, reasoning: '   ' })).toEqual({ confidence: 0.75, reasoning: null });
  });

  it('says the answered choice as the nearest of the four', () => {
    expect(howSureChoice(0.74)?.label).toBe('Fairly sure');
    expect(howSureChoice(null)).toBeNull();
    expect(howSureLine(0.25)).toBe('You were guessing.');
    expect(howSureLine(0.95)).toBe('You were certain.');
    expect(howSureLine(null)).toBeNull();
  });

  it('copies the confidence of the answer behind a row of evidence', () => {
    expect(evidenceConfidence({ question: { confidence: 0.75 }, probe: null })).toBe(0.75);
    expect(evidenceConfidence({ question: null, probe: { confidence: '0.95' } })).toBe(0.95);
    expect(evidenceConfidence({ question: [{ confidence: 0.25 }] })).toBe(0.25);
    expect(evidenceConfidence({ question: null, probe: null })).toBeNull();
    expect(evidenceConfidence({})).toBeNull();
  });
});

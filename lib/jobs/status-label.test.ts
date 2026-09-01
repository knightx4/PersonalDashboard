import { describe, expect, it } from 'vitest';
import { statusLabel } from './status-label';

describe('statusLabel', () => {
  it('reads "Withdrawn" for a pursuit that was actually submitted', () => {
    expect(statusLabel('withdrawn', true)).toBe('Withdrawn');
  });

  it('reads "Turned down" for a lead or draft withdrawn before ever applying', () => {
    expect(statusLabel('withdrawn', false)).toBe('Turned down');
  });

  it('defaults to "Withdrawn" when submission status is not given', () => {
    expect(statusLabel('withdrawn')).toBe('Withdrawn');
  });

  it('leaves every other status alone regardless of everSubmitted', () => {
    expect(statusLabel('rejected', false)).toBe('Rejected');
    expect(statusLabel('offer', false)).toBe('Offer');
  });
});

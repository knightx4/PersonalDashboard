import { describe, expect, it } from 'vitest';
import { boardMoment, openApplications, stillOpenLine } from './board-moment';

describe('boardMoment', () => {
  it('a later stage is a move forward, and Offer is its own moment', () => {
    expect(boardMoment('drafting', 'acknowledged')).toBe('forward');
    expect(boardMoment('acknowledged', 'in_process')).toBe('forward');
    expect(boardMoment('in_process', 'offer')).toBe('offer');
  });

  it('a move back, or to the same place, plays nothing', () => {
    expect(boardMoment('in_process', 'acknowledged')).toBeNull();
    expect(boardMoment('offer', 'offer')).toBeNull();
  });

  it('a rejection from a live stage is the rejection, and nothing else closed plays', () => {
    expect(boardMoment('acknowledged', 'rejected')).toBe('rejection');
    expect(boardMoment('lead', 'rejected')).toBe('rejection');
    expect(boardMoment('ghosted', 'rejected')).toBeNull();
    expect(boardMoment('in_process', 'withdrawn')).toBeNull();
    expect(boardMoment('rejected', 'in_process')).toBeNull();
  });
});

describe('openApplications and stillOpenLine', () => {
  it('counts what has been sent and not closed', () => {
    const rows = (['lead', 'drafting', 'submitted', 'in_process', 'offer', 'rejected'] as const).map(
      (status) => ({ status }),
    );
    expect(openApplications(rows)).toBe(3);
  });

  it('names the company and the count plainly', () => {
    expect(stillOpenLine('Acme', 4)).toBe('4 still open · Acme is in Closed');
    expect(stillOpenLine('Acme', 1)).toBe('1 still open · Acme is in Closed');
    expect(stillOpenLine('', 0)).toBe('None still open · Moved to Closed');
  });
});

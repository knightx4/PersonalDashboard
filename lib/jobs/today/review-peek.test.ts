import { describe, expect, it } from 'vitest';
import type { ReviewRow } from '@/lib/jobs/review/load';
import { reviewPeek } from './review-peek';

describe('reviewPeek', () => {
  it('counts every waiting import and names the first three', () => {
    const rows = [
      { kind: 'message', id: 'm1', subject: '  ', fromAddress: 'jobs@monzo.com', classification: 'recruiter_reply' },
      { kind: 'application', id: 'a1', companyName: 'Wise', roleTitle: 'Engineer' },
      { kind: 'event', id: 'e1', companyName: 'Cleo', roleTitle: 'Engineer' },
      { kind: 'message', id: 'm2', subject: 'Hello', fromAddress: null, classification: 'offer' },
    ] as ReviewRow[];
    const peek = reviewPeek(rows);
    expect(peek.count).toBe(4);
    expect(peek.items).toEqual([
      { id: 'm1', title: 'jobs@monzo.com', kind: 'Recruiter reply email' },
      { id: 'a1', title: 'Wise · Engineer', kind: 'New application from mail' },
      { id: 'e1', title: 'Cleo · Engineer', kind: 'Mail after it closed' },
    ]);
  });
});

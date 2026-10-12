/** The Needs confirming section on the newsletter list (plan #1725). */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/news/i/[id]/actions', () => ({ confirmIssue: async () => {} }));

import { NeedsConfirming } from '@/app/news/all/needs-confirming';

const sender = { id: 's1', email: 'hi@paper.test', name: 'The Paper', muted: false };

describe('NeedsConfirming', () => {
  it('draws nothing when no signup waits', () => {
    const html = renderToStaticMarkup(
      <NeedsConfirming signups={[]} senders={new Map()} timezone="UTC" />,
    );
    expect(html).toBe('');
  });

  it('draws the sender and a Confirm link for each waiting signup', () => {
    const html = renderToStaticMarkup(
      <NeedsConfirming
        signups={[
          {
            id: 'i1',
            senderId: 's1',
            subject: 'Confirm',
            receivedAt: '2026-10-05T10:00:00Z',
            confirmUrl: 'https://paper.test/c?t=1',
          },
        ]}
        senders={new Map([['s1', sender]])}
        timezone="UTC"
      />,
    );
    expect(html).toContain('Needs confirming');
    expect(html).toContain('The Paper');
    expect(html).toContain('href="https://paper.test/c?t=1"');
    expect(html).toContain('Confirm');
  });
});

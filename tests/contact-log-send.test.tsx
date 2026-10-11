/**
 * Logging a send is one press, and a send's channel and words are edited on
 * its own line in the log rather than in a form above it (plan #1434).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/jobs/(app)/contacts/actions', () => ({}));

const { ContactDetail } = await import('@/app/jobs/(app)/contacts/[id]/contact-detail');

const contact = {
  id: 'c-1',
  fullName: 'Ada Byron',
  title: 'Analyst',
  relationship: 'alum',
  status: 'contacted',
  linkedinUrl: null,
  email: null,
  howWeConnect: null,
  notes: null,
  companyName: null,
  companySlug: null,
  touches: [
    {
      id: 't-1',
      channel: 'email',
      direction: 'outbound',
      sentAt: '2026-09-30T10:00:00Z',
      respondedAt: null,
      message: 'Asked about the team',
    },
  ],
};

describe('ContactDetail', () => {
  const html = renderToStaticMarkup(<ContactDetail contact={contact} timezone="Europe/London" />);

  it('offers Log a send as one button with no fields beside it', () => {
    expect(html).toMatch(/<button[^>]*>.*Log a send<\/button>/);
    // Nothing to type into beside it: a send's words are edited on its own
    // line in the log, and only once they are pressed.
    expect(html).not.toMatch(/<(?:input|textarea)[^>]*aria-label="What you said"/);
  });

  it('shows each send as its channel chip and its words, edited in place', () => {
    expect(html).toMatch(/<select[^>]*aria-label="How it went out"/);
    expect(html).toMatch(/<option value="email" selected="">email<\/option>/);
    // At rest the words are text that wraps, and pressing them opens the
    // editor where they are (law 14).
    expect(html).toMatch(/<button[^>]*title="Edit what you said"[^>]*>Asked about the team<\/button>/);
  });
});

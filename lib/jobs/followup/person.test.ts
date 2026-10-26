import { describe, expect, it } from 'vitest';
import { channelFor, followUpAim, pickOnFile, type FileContact } from '@/lib/jobs/followup/person';
import { parsePeople } from '@/lib/jobs/followup/find-person';

function contact(id: string, overrides: Partial<FileContact> = {}): FileContact {
  return {
    id,
    fullName: `Person ${id}`,
    title: null,
    email: null,
    linkedinUrl: null,
    relationship: 'cold',
    status: 'to_contact',
    linkedinConnection: false,
    ...overrides,
  };
}

const pick = (contacts: FileContact[], extra: { referral?: string; correspondent?: string } = {}) =>
  pickOnFile({
    contacts,
    company: 'Ramp',
    referralContactId: extra.referral ?? null,
    correspondentEmail: extra.correspondent ?? null,
  });

describe('who an application is followed up with', () => {
  it('names nobody when nobody is on file', () => {
    expect(pick([])).toBeNull();
  });

  it('puts the referrer first', () => {
    const chosen = pick([contact('a', { relationship: 'friend' }), contact('b')], { referral: 'b' });
    expect(chosen?.contactId).toBe('b');
    expect(chosen?.why).toBe('Person b referred you for this role.');
  });

  it('puts the recruiter who wrote about the application next, by email', () => {
    const chosen = pick(
      [contact('a', { relationship: 'friend' }), contact('r', { email: 'Rae@Ramp.com', relationship: 'recruiter' })],
      { correspondent: 'rae@ramp.com' },
    );
    expect(chosen).toEqual({ contactId: 'r', why: 'Person r wrote to you about this application.', channel: 'email' });
  });

  it('prefers someone they know over a LinkedIn connection, and that over a cold contact', () => {
    expect(pick([contact('c'), contact('l', { linkedinConnection: true }), contact('f', { relationship: 'former_colleague' })])?.contactId).toBe('f');
    expect(pick([contact('c'), contact('l', { linkedinConnection: true })])?.contactId).toBe('l');
  });

  it('within a tier, prefers someone whose title says they hire', () => {
    const chosen = pick([contact('a', { title: 'Analyst' }), contact('b', { title: 'Head of Finance' })]);
    expect(chosen?.contactId).toBe('b');
  });

  it('leaves out a dormant contact unless they referred or wrote', () => {
    expect(pick([contact('d', { status: 'dormant' })])).toBeNull();
    expect(pick([contact('d', { status: 'dormant' })], { referral: 'd' })?.contactId).toBe('d');
  });
});

describe('how the note goes', () => {
  it('emails a recruiter with an address', () => {
    expect(channelFor({ email: 'a@b.com', relationship: 'recruiter', status: 'to_contact', linkedinConnection: false })).toBe('email');
  });

  it('messages a connection on LinkedIn', () => {
    expect(channelFor({ email: 'a@b.com', relationship: 'friend', status: 'to_contact', linkedinConnection: true })).toBe('linkedin_dm');
  });

  it('sends a connection note to a stranger with no address', () => {
    expect(channelFor({ email: null, relationship: 'cold', status: 'to_contact', linkedinConnection: false })).toBe('linkedin_connect');
  });
});

describe('what the note is for', () => {
  it('says the application is in once it is', () => {
    expect(followUpAim({ role: 'Strategic Finance', company: 'Ramp', applied: true })).toContain('just applied for the Strategic Finance role at Ramp');
  });

  it('asks first when it has not gone in yet', () => {
    expect(followUpAim({ role: 'Strategic Finance', company: 'Ramp', applied: false })).toContain('about to apply');
  });
});

describe('the person the web search reports', () => {
  it('keeps one person, with a LinkedIn link only when it is a profile', () => {
    const people = parsePeople({
      people: [
        { name: ' Dana Wu ', title: 'Head of FP&A', source_url: 'https://ramp.com/team', linkedin_url: 'https://www.linkedin.com/company/ramp', why: 'The role reports to her.' },
        { name: 'Second', why: 'Not kept.' },
      ],
    });
    expect(people).toEqual([
      { name: 'Dana Wu', title: 'Head of FP&A', sourceUrl: 'https://ramp.com/team', linkedinUrl: null, why: 'The role reports to her.' },
    ]);
  });

  it('drops a person with no reason given', () => {
    expect(parsePeople({ people: [{ name: 'Dana Wu', why: '' }] })).toEqual([]);
  });
});

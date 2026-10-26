import { describe, expect, it } from 'vitest';
import { channelFor, followUpAim, pickOnFile, pickWarm, teamWords, type FileContact } from '@/lib/jobs/followup/person';
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

const pick = (contacts: FileContact[], extra: { referral?: string; correspondent?: string; role?: string } = {}) =>
  pickOnFile({
    contacts,
    company: 'Ramp',
    role: extra.role ?? 'Strategic Finance Lead',
    referralContactId: extra.referral ?? null,
    correspondentEmail: extra.correspondent ?? null,
  });

describe('who an application is followed up with', () => {
  it('names nobody when nobody is on file', () => {
    expect(pick([])).toBeNull();
  });

  it('puts the referrer first', () => {
    const chosen = pick([contact('a', { relationship: 'recruiter' }), contact('b')], { referral: 'b' });
    expect(chosen?.contactId).toBe('b');
    expect(chosen?.why).toBe('Person b referred you for this role.');
  });

  it('puts the recruiter who wrote about the application next, by email', () => {
    const chosen = pick(
      [contact('m', { title: 'Head of Finance' }), contact('r', { email: 'Rae@Ramp.com', relationship: 'recruiter' })],
      { correspondent: 'rae@ramp.com' },
    );
    expect(chosen).toEqual({ contactId: 'r', why: 'Person r wrote to you about this application.', channel: 'email' });
  });

  it('puts a manager on the role\'s team before a recruiter, and a recruiter before a team member', () => {
    const manager = contact('m', { title: 'Head of Financial Planning' });
    const recruiter = contact('r', { title: 'Talent Partner' });
    const member = contact('t', { title: 'Finance Analyst' });
    expect(pick([member, recruiter, manager])?.contactId).toBe('m');
    expect(pick([member, recruiter])?.contactId).toBe('r');
    expect(pick([member])?.contactId).toBe('t');
  });

  it('passes over people they know who are not on the team or recruiting', () => {
    const friend = contact('f', { relationship: 'friend', title: 'Agent Strategy Manager' });
    const alum = contact('a', { relationship: 'alum', title: 'Head of GTM', linkedinConnection: true });
    expect(pick([friend, alum])).toBeNull();
    expect(pick([friend, alum, contact('r', { relationship: 'recruiter' })])?.contactId).toBe('r');
  });

  it('does not count words every role here carries as the same team', () => {
    expect(pick([contact('s', { title: 'Agent Strategy Manager' })], { role: 'Revenue Strategy & Operations Manager' })).toBeNull();
    expect(pick([contact('v', { title: 'VP, Revenue' })], { role: 'Revenue Strategy & Operations Manager' })?.contactId).toBe('v');
  });

  it('reads FP&A as finance', () => {
    expect(teamWords('Senior Analyst, FP&A')).toEqual(teamWords('Finance Planning'));
  });

  it('leaves out a dormant contact unless they referred or wrote', () => {
    expect(pick([contact('d', { status: 'dormant', relationship: 'recruiter' })])).toBeNull();
    expect(pick([contact('d', { status: 'dormant' })], { referral: 'd' })?.contactId).toBe('d');
  });
});

describe('the fallback when nobody hiring turns up', () => {
  it('takes a friend over an alum over a second-degree connection over a LinkedIn connection', () => {
    const people = [
      contact('l', { linkedinConnection: true }),
      contact('s', { relationship: 'second_degree' }),
      contact('a', { relationship: 'alum' }),
      contact('f', { relationship: 'friend' }),
    ];
    expect(pickWarm(people, 'Ramp')?.contactId).toBe('f');
    expect(pickWarm(people.slice(0, 3), 'Ramp')?.contactId).toBe('a');
  });

  it('never falls back to a stranger', () => {
    expect(pickWarm([contact('c')], 'Ramp')).toBeNull();
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

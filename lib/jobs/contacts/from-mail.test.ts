import { describe, expect, it } from 'vitest';
import {
  contactFromSender,
  contactsFromInvite,
  contactsFromNames,
  isPersonalAddress,
  isRelayAddress,
  looksLikeAPerson,
  namesInLabel,
  stripVia,
} from '@/lib/jobs/contacts/from-mail';

describe('telling a person from a mailbox', () => {
  it('accepts an ordinary personal address', () => {
    expect(isPersonalAddress('Dana Whitfield <dana.whitfield@ramp.com>')).toBe(true);
    expect(isPersonalAddress('d.whitfield@ramp.com')).toBe(true);
  });

  it('rejects the mailboxes that are a function', () => {
    for (const address of [
      'no-reply@ashbyhq.com',
      'noreply@greenhouse.io',
      'careers@ramp.com',
      'talent.acquisition@ramp.com',
      'careers-uk@ramp.com',
      'notifications+123@lever.co',
    ]) {
      expect(isPersonalAddress(address), address).toBe(false);
    }
  });

  it('does not reject a real name that happens to contain one', () => {
    // `noreen`, `jobst` and `hrafn` are names. Matching on substrings rather
    // than on whole segments would quietly lose all three.
    expect(isPersonalAddress('noreen@ramp.com')).toBe(true);
    expect(isPersonalAddress('jobst@ramp.com')).toBe(true);
    expect(isPersonalAddress('hrafn.olafsson@ramp.com')).toBe(true);
  });

  it('rejects a mailbox that runs the words together', () => {
    // The two attendees on every slot of a Greenhouse superday. Both were
    // recorded as members of the panel: neither is separated by a dot, and
    // `schedule` was a spelling the set did not have.
    expect(isPersonalAddress('galaxyinterviews@galaxydigital.io')).toBe(false);
    expect(isPersonalAddress('schedule@lily.greenhouse.io')).toBe(false);
    expect(isPersonalAddress('talentacquisition@ramp.com')).toBe(false);
  });
});

describe('telling a person from an organisation', () => {
  it('accepts a full name and a lone given name', () => {
    expect(looksLikeAPerson('Dana Whitfield')).toBe(true);
    expect(looksLikeAPerson('Dana')).toBe(true);
  });

  it('rejects the names that are departments', () => {
    for (const name of [
      'Kalshi Hiring Team',
      'Greenhouse Notifications',
      'Ramp Recruiting',
      'Talent Acquisition',
      'University Careers',
      'no-reply',
    ]) {
      expect(looksLikeAPerson(name), name).toBe(false);
    }
  });

  it('rejects an address, an initial and nothing at all', () => {
    expect(looksLikeAPerson('dana@ramp.com')).toBe(false);
    expect(looksLikeAPerson('-')).toBe(false);
    expect(looksLikeAPerson(null)).toBe(false);
  });
});

describe('the sender of a message', () => {
  it('records the recruiter who wrote to you', () => {
    expect(
      contactFromSender({
        classification: 'recruiter_outreach',
        fromAddress: 'Dana Whitfield <dana@ramp.com>',
      }),
    ).toEqual({ fullName: 'Dana Whitfield', email: 'dana@ramp.com', relationship: 'recruiter' });
  });

  it('prefers the reply-to, where a scheduling tool put the human', () => {
    expect(
      contactFromSender({
        classification: 'scheduling',
        fromAddress: 'GoodTime <no-reply@goodtime.io>',
        replyToAddress: 'Dana Whitfield <dana@ramp.com>',
      })?.email,
    ).toBe('dana@ramp.com');
  });

  it('records nobody from a rejection, however warmly it is worded', () => {
    // A mail merge is not somebody you know, and the name on it is a signature
    // block rather than a correspondent.
    expect(
      contactFromSender({
        classification: 'rejection',
        fromAddress: 'Dana Whitfield <dana@ramp.com>',
      }),
    ).toBeNull();
    expect(
      contactFromSender({
        classification: 'application_confirmation',
        fromAddress: 'Dana Whitfield <dana@ramp.com>',
      }),
    ).toBeNull();
  });

  it('records nobody from a departmental sender', () => {
    expect(
      contactFromSender({
        classification: 'recruiter_outreach',
        fromAddress: 'Kalshi Hiring Team <no-reply@ashbyhq.com>',
      }),
    ).toBeNull();
  });

  it('records nobody from a bare address with no name', () => {
    expect(
      contactFromSender({ classification: 'recruiter_outreach', fromAddress: 'dana@ramp.com' }),
    ).toBeNull();
  });

  it('does not make you one of your own contacts', () => {
    // A calendar invite you sent comes back through the same pipeline.
    expect(
      contactFromSender({
        classification: 'scheduling',
        fromAddress: 'Selvey Knight <me@example.com>',
        selfAddress: 'me@example.com',
      }),
    ).toBeNull();
  });

  it('keeps the person out of a LinkedIn relay, and drops the relay address', () => {
    // The reply address is a per-message uuid: storing it would make one
    // recruiter into as many contacts as they sent messages.
    expect(
      contactFromSender({
        classification: 'recruiter_outreach',
        fromAddress: '"Anthony Greenfield, CPA" <hit-reply@linkedin.com>',
        replyToAddress:
          '"Anthony Greenfield, CPA" <023c3819-d05e-4381-a7aa-19a044f834fb@reply.linkedin.com>',
      }),
    ).toEqual({ fullName: 'Anthony Greenfield, CPA', email: null, relationship: 'recruiter' });
  });

  it('takes the name from one header and the address from the other', () => {
    // Calendly signs as itself and puts the real address in reply-to. Taking
    // both from one header loses either the name or the address.
    expect(
      contactFromSender({
        classification: 'scheduling',
        fromAddress: '"Sam Young (via Calendly)" <notifications@calendly.com>',
        replyToAddress: 'sam@levelcfo.com',
      }),
    ).toEqual({ fullName: 'Sam Young', email: 'sam@levelcfo.com', relationship: 'recruiter' });
  });

  it('records nobody from a service account shaped like a name', () => {
    expect(
      contactFromSender({
        classification: 'interview_invite',
        fromAddress: 'svc-ai-trainer <svc-ai-trainer@linkedin.com>',
      }),
    ).toBeNull();
  });

  it('records nobody from a Workday notification pointed at HR', () => {
    expect(
      contactFromSender({
        classification: 'interview_invite',
        fromAddress: 'Workday Notifications <PJTPartners@myworkday.com>',
        replyToAddress: 'HR@pjtpartners.com',
      }),
    ).toBeNull();
  });
});

describe('the smaller readers', () => {
  it('strips the tool out of a display name', () => {
    expect(stripVia('Sam Young (via Calendly)')).toBe('Sam Young');
    expect(stripVia('Dana Whitfield (on behalf of Ramp)')).toBe('Dana Whitfield');
    expect(stripVia('Dana Whitfield')).toBe('Dana Whitfield');
  });

  it('knows a per-message relay from an ordinary domain', () => {
    expect(isRelayAddress('x@reply.linkedin.com')).toBe(true);
    expect(isRelayAddress('dana@ramp.com')).toBe(false);
  });
});

describe('the people on an invite', () => {
  it('records the attendees, paired with their addresses', () => {
    expect(
      contactsFromInvite({
        interviewerNames: ['Dana Whitfield', 'Sam Okafor'],
        interviewerEmails: ['dana@ramp.com', 'sam@ramp.com'],
      }),
    ).toEqual([
      { fullName: 'Dana Whitfield', email: 'dana@ramp.com', relationship: 'interviewer' },
      { fullName: 'Sam Okafor', email: 'sam@ramp.com', relationship: 'interviewer' },
    ]);
  });

  it('keeps an attendee whose invite gave no name', () => {
    // On an invite a bare address is still somebody you will be in a room
    // with, which is not true of a From header.
    expect(
      contactsFromInvite({ interviewerNames: [], interviewerEmails: ['dana@ramp.com'] }),
    ).toEqual([{ fullName: 'dana@ramp.com', email: 'dana@ramp.com', relationship: 'interviewer' }]);
  });

  it('drops the room and the meeting bot', () => {
    expect(
      contactsFromInvite({
        interviewerNames: ['Dana Whitfield', 'Interviews'],
        interviewerEmails: ['dana@ramp.com', 'interviews@ramp.com'],
      }),
    ).toHaveLength(1);
  });

  it('does not record the same person twice', () => {
    expect(
      contactsFromInvite({
        interviewerNames: ['Dana Whitfield', 'Dana Whitfield'],
        interviewerEmails: ['dana@ramp.com', 'DANA@ramp.com'],
      }),
    ).toHaveLength(1);
  });

  it('records nobody from the scheduling robot the superday invited', () => {
    expect(
      contactsFromInvite({
        interviewerNames: ['Galaxy Interviews', ''],
        interviewerEmails: ['galaxyinterviews@galaxydigital.io', 'schedule@lily.greenhouse.io'],
      }),
    ).toEqual([]);
  });
});

describe('the people a body named', () => {
  it('records a panel that has no addresses at all', () => {
    expect(contactsFromNames(['Ryan Kleiner', 'Bill Burt'])).toEqual([
      { fullName: 'Ryan Kleiner', email: null, relationship: 'interviewer' },
      { fullName: 'Bill Burt', email: null, relationship: 'interviewer' },
    ]);
  });

  it('drops departments, blanks and repeats', () => {
    expect(
      contactsFromNames(['Ryan Kleiner', 'Hiring Team', null, ' ryan  kleiner ']),
    ).toHaveLength(1);
  });

  it('reads who takes one slot out of its label', () => {
    const panel = ['Ryan Kleiner', 'Bill Burt', 'Jiaying Wang', 'Joe Koyfman'];
    expect(namesInLabel(panel, 'Interview with Jiaying Wang, Joe Koyfman')).toEqual([
      'Jiaying Wang',
      'Joe Koyfman',
    ]);
    expect(namesInLabel(panel, 'Onsite loop')).toEqual([]);
    expect(namesInLabel(panel, null)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics';
import {
  formatFromInvite,
  interviewFromInvite,
  inviteSupersedes,
  kindFromInvite,
} from './invite';

function invite(lines: string[]) {
  return parseIcs(
    ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:test@example.com', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join(
      '\r\n',
    ),
  )[0];
}

describe('formatFromInvite', () => {
  it('calls anything with a conference link a video interview', () => {
    const event = invite([
      'DTSTART:20260903T140000Z',
      'LOCATION:28 W 23rd St\\, New York\\, NY',
      'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
    ]);
    // Plenty of onsite-looking invites carry a dial-in. The link decides.
    expect(formatFromInvite(event)).toBe('video');
  });

  it('reads a street address as an onsite', () => {
    const event = invite([
      'DTSTART:20260903T140000Z',
      'LOCATION:28 W 23rd St\\, 2nd Floor\\, New York\\, NY 10010',
    ]);
    expect(formatFromInvite(event)).toBe('onsite');
  });

  it('reads a dial-in as a phone screen', () => {
    const event = invite(['DTSTART:20260903T140000Z', 'LOCATION:Dana will call you on +1 555 010 9988']);
    expect(formatFromInvite(event)).toBe('phone');
  });

  it('falls back to the title when the location says nothing', () => {
    expect(formatFromInvite(invite(['DTSTART:20260903T140000Z', 'SUMMARY:Phone screen']))).toBe('phone');
    expect(formatFromInvite(invite(['DTSTART:20260903T140000Z', 'SUMMARY:Onsite loop']))).toBe('onsite');
  });

  it('admits it does not know rather than guessing', () => {
    expect(formatFromInvite(invite(['DTSTART:20260903T140000Z', 'SUMMARY:Chat with Dana']))).toBeNull();
  });
});

describe('kindFromInvite', () => {
  it('names the round when the invite does', () => {
    expect(kindFromInvite(invite(['SUMMARY:Recruiter screen — Ramp']))).toBe('recruiter_screen');
    expect(kindFromInvite(invite(['SUMMARY:Technical interview (coding)']))).toBe('technical');
    expect(kindFromInvite(invite(['SUMMARY:Final round']))).toBe('final');
    expect(kindFromInvite(invite(['SUMMARY:Panel with the platform team']))).toBe('panel');
    expect(kindFromInvite(invite(['SUMMARY:Case study discussion']))).toBe('case');
    expect(kindFromInvite(invite(['SUMMARY:Chat with the hiring manager']))).toBe('hiring_manager');
  });

  it('stays quiet when the title names no round', () => {
    // Overwriting the extractor's read of the thread with a guess is worse
    // than leaving it alone.
    expect(kindFromInvite(invite(['SUMMARY:Interview with Dana']))).toBeNull();
  });
});

describe('interviewFromInvite', () => {
  const full = parseIcs(
    [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:6k1p9c8m4v2q@google.com',
      'SEQUENCE:1',
      'SUMMARY:Ramp / Technical interview',
      'DTSTART;TZID=America/New_York:20260903T140000',
      'DTEND;TZID=America/New_York:20260903T150000',
      'ORGANIZER;CN=Dana Ruiz:mailto:dana.ruiz@ramp.com',
      'ATTENDEE;CN=Priya Anand:mailto:priya.anand@ramp.com',
      'ATTENDEE;CN=Dana Ruiz:mailto:dana.ruiz@ramp.com',
      'ATTENDEE;CN=You:mailto:you@example.com',
      'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  )[0];

  it('reduces an invite to the appointment it books', () => {
    const result = interviewFromInvite(full, { selfEmail: 'you@example.com' });

    expect(result).not.toBeNull();
    expect(result!.scheduledAt).toBe('2026-09-03T18:00:00.000Z');
    expect(result!.durationMinutes).toBe(60);
    expect(result!.format).toBe('video');
    expect(result!.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(result!.timeZone).toBe('America/New_York');
    expect(result!.kind).toBe('technical');
    expect(result!.cancelled).toBe(false);
  });

  it('leaves you off your own interviewer list', () => {
    const result = interviewFromInvite(full, { selfEmail: 'you@example.com' });
    expect(result!.interviewerEmails).toEqual(['dana.ruiz@ramp.com', 'priya.anand@ramp.com']);
    expect(result!.interviewerNames).toEqual(['Dana Ruiz', 'Priya Anand']);
  });

  it('does not count the organiser twice for also being an attendee', () => {
    const result = interviewFromInvite(full, { selfEmail: 'you@example.com' });
    expect(result!.interviewerEmails).toHaveLength(2);
  });

  it('ignores case when matching your own address', () => {
    const result = interviewFromInvite(full, { selfEmail: 'You@Example.COM' });
    expect(result!.interviewerEmails).not.toContain('you@example.com');
  });

  it('carries a cancellation through', () => {
    const cancelled = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'METHOD:CANCEL',
        'BEGIN:VEVENT',
        'UID:6k1p9c8m4v2q@google.com',
        'SEQUENCE:2',
        'STATUS:CANCELLED',
        'DTSTART:20260903T180000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    )[0];

    const result = interviewFromInvite(cancelled);
    expect(result!.cancelled).toBe(true);
    expect(result!.icsUid).toBe('6k1p9c8m4v2q@google.com');
    expect(result!.icsSequence).toBe(2);
  });

  it('refuses an all-day block, which is a deadline and not an appointment', () => {
    const allDay = invite(['DTSTART;VALUE=DATE:20260903', 'SUMMARY:Take-home due']);
    expect(interviewFromInvite(allDay)).toBeNull();
  });

  it('refuses an invite with no usable start', () => {
    const undated = invite(['SUMMARY:Interview']);
    expect(interviewFromInvite(undated)).toBeNull();
  });
});

describe('inviteSupersedes', () => {
  it('accepts a newer revision', () => {
    expect(inviteSupersedes({ icsSequence: 2 }, { icsSequence: 1 })).toBe(true);
  });

  it('accepts a redelivery of the same revision', () => {
    // Re-running a sync must be idempotent, not a no-op that drops corrections.
    expect(inviteSupersedes({ icsSequence: 1 }, { icsSequence: 1 })).toBe(true);
  });

  it('rejects an older revision arriving late', () => {
    expect(inviteSupersedes({ icsSequence: 0 }, { icsSequence: 3 })).toBe(false);
  });

  it('accepts anything over a row that has no sequence yet', () => {
    expect(inviteSupersedes({ icsSequence: 0 }, { icsSequence: null })).toBe(true);
  });
});

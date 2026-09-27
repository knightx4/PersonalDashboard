import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyRecurring } from '@/lib/recurring/rules';
import { appointmentCatchUpQuery, classifyAppointment } from './rules';
import {
  heuristicAppointment,
  parseAppointmentExtraction,
  parseClock,
  providerKey,
  type AppointmentExtraction,
} from './extraction';
import { resolveAppointment, type StoredAppointment } from './resolve';

/**
 * The appointments linker against saved messages (plan #1127).
 *
 * fixtures/emails/appointments holds a dentist's confirmation, the change and
 * the cancellation that follow it, a restaurant table and a salon booking,
 * and three messages the linker must leave alone: a calendar invitation, a
 * flight check-in and a job interview. They are written to each sender's
 * usual layout, not saved from the inbox. The order fixtures beside them are
 * saved order mail, which must stay the commerce linker's.
 */

type Fixture = { subject: string; fromAddress: string | null; text: string };

function load(name: string): Fixture {
  const raw = readFileSync(resolve(__dirname, '../../../fixtures/emails', name), 'utf8');
  const subject = raw.match(/^Subject: (.*)$/m)?.[1] ?? '';
  const from = raw.match(/^From: (.*)$/m)?.[1] ?? null;
  const body = raw.replace(/^(?:Subject|From): .*\n/gm, '').trim();
  return { subject, fromAddress: from, text: body };
}

const RECEIVED_ON = '2026-09-27';

function read(name: string, receivedOn = RECEIVED_ON): AppointmentExtraction | null {
  const email = load(`appointments/${name}`);
  const verdict = classifyAppointment(email);
  if (!verdict.claim) throw new Error(`${name} was not claimed`);
  return heuristicAppointment({ ...email, receivedOn, hint: verdict.hint });
}

describe('classifyAppointment on saved mail', () => {
  it.each([
    ['dentist-confirmation.txt', 'booked'],
    ['dentist-rescheduled.txt', 'rescheduled'],
    ['dentist-cancelled.txt', 'cancelled'],
    ['opentable-confirmed.txt', 'booked'],
    ['salon-booked.txt', 'booked'],
  ])('claims %s as %s', (name, hint) => {
    expect(classifyAppointment(load(`appointments/${name}`))).toMatchObject({ claim: true, hint });
  });

  it.each([
    ['calendar-invite.txt', 'invite'],
    ['flight-reminder.txt', 'travel'],
    ['interview-scheduled.txt', 'other_linker'],
  ])('leaves %s alone (%s)', (name, reason) => {
    expect(classifyAppointment(load(`appointments/${name}`))).toEqual({ claim: false, reason });
  });

  it.each([
    'amazon-order-confirmation.txt',
    'amazon-shipped.txt',
    'amazon-delivered.txt',
    'amazon-refund.txt',
    'shopify-allplay-order.txt',
  ])('leaves the order mail %s to the commerce linker', (name) => {
    expect(classifyAppointment(load(name)).claim).toBe(false);
  });

  it('leaves bills to the recurring linker, and the recurring linker leaves bookings', () => {
    const bill = load('recurring/coned-bill.txt');
    expect(classifyAppointment(bill).claim).toBe(false);
    for (const name of ['dentist-confirmation.txt', 'opentable-confirmed.txt', 'salon-booked.txt']) {
      expect(classifyRecurring(load(`appointments/${name}`)).claim).toBe(false);
    }
  });

  it('claims a booking site on a name and a day alone', () => {
    expect(
      classifyAppointment({ fromAddress: 'Resy <notify@resy.com>', subject: 'Confirmed: Via Carota, Fri' }),
    ).toMatchObject({ claim: true, reason: 'sender' });
    expect(
      classifyAppointment({ fromAddress: 'Resy <notify@resy.com>', subject: 'New restaurants this week' }).claim,
    ).toBe(false);
  });

  it('searches three months back by subject and by booking site', () => {
    const query = appointmentCatchUpQuery();
    expect(query).toMatch(/^newer_than:90d \(/);
    expect(query).toContain('subject:appointment');
    expect(query).toContain('opentable.com');
  });
});

describe('heuristicAppointment', () => {
  it('reads the day, time, place and confirmation number', () => {
    expect(read('dentist-confirmation.txt')).toMatchObject({
      event: 'booked',
      provider: 'Smile Dental',
      reference: 'SD48213',
      date: '2026-10-06',
      time: '15:30',
      location: '120 Grand St, Brooklyn, NY 11211',
    });
  });

  it('reads a table with its year and a salon slot', () => {
    expect(read('opentable-confirmed.txt')).toMatchObject({
      title: 'Reservation',
      date: '2026-10-10',
      time: '19:45',
      reference: '110482',
    });
    expect(read('salon-booked.txt')).toMatchObject({
      date: '2026-10-02',
      time: '11:00',
      reference: 'BK-7731',
      location: '44 Bedford Ave, Brooklyn',
    });
  });

  it('puts a January day read in December in the next year', () => {
    const reading = heuristicAppointment({
      subject: 'Appointment reminder',
      text: 'See you on Jan 4 at 9:00 AM.',
      fromAddress: 'Clinic <a@clinic.example>',
      receivedOn: '2026-12-20',
      hint: 'reminder',
    });
    expect(reading?.date).toBe('2027-01-04');
  });

  it('gives up on a booking with no day, but keeps a cancellation', () => {
    const noDay = { subject: 'Your appointment', text: 'Thanks!', fromAddress: null, receivedOn: RECEIVED_ON };
    expect(heuristicAppointment({ ...noDay, hint: 'booked' })).toBeNull();
    expect(heuristicAppointment({ ...noDay, hint: 'cancelled' })).toMatchObject({ event: 'cancelled', date: null });
  });

  it('reads clocks', () => {
    expect(parseClock('3:30 PM')).toBe('15:30');
    expect(parseClock('12 am')).toBe('00:00');
    expect(parseClock('12:15 p.m.')).toBe('12:15');
    expect(parseClock('9:05')).toBe('09:05');
  });
});

describe('parseAppointmentExtraction', () => {
  it('accepts a whole answer and refuses a booking with no day', () => {
    const answer = {
      event: 'booked',
      title: 'Haircut',
      provider: 'Fade Room',
      reference: null,
      date: '2026-10-02',
      time: '11:00',
      endTime: '11:45',
      location: '44 Bedford Ave',
      previousDate: null,
      previousTime: null,
    };
    expect(parseAppointmentExtraction(answer)).toMatchObject({ ok: true, value: { time: '11:00' } });
    expect(parseAppointmentExtraction({ ...answer, date: null })).toEqual({ ok: false, notAppointment: false });
    expect(parseAppointmentExtraction({ ...answer, time: '3:30 PM' })).toEqual({ ok: false, notAppointment: false });
    expect(parseAppointmentExtraction({ error: 'not_appointment' })).toEqual({ ok: false, notAppointment: true });
  });

  it('keys a provider the same however it is written', () => {
    expect(providerKey('Smile Dental, LLC')).toBe(providerKey('SMILE DENTAL'));
  });
});

describe('resolveAppointment', () => {
  const ZONE = 'America/New_York';
  const booking = read('dentist-confirmation.txt')!;

  function stored(overrides: Partial<StoredAppointment> = {}): StoredAppointment {
    return {
      id: 'a1',
      reference: 'SD48213',
      startsOn: '2026-10-06',
      startsAt: '2026-10-06T19:30:00.000Z',
      status: 'booked',
      asOf: '2026-09-20T12:00:00.000Z',
      ...overrides,
    };
  }

  it('files a new booking at its time in the person’s zone', () => {
    expect(
      resolveAppointment({ reading: booking, candidates: [], receivedAt: '2026-09-20T12:00:00Z', timezone: ZONE }),
    ).toEqual({
      action: 'insert',
      status: 'booked',
      when: { startsOn: '2026-10-06', startsAt: '2026-10-06T19:30:00.000Z', endsAt: null },
    });
  });

  it('moves the booking a change names by its confirmation number', () => {
    const change = read('dentist-rescheduled.txt')!;
    expect(
      resolveAppointment({
        reading: change,
        candidates: [stored()],
        receivedAt: '2026-09-25T12:00:00Z',
        timezone: ZONE,
      }),
    ).toEqual({
      action: 'update',
      id: 'a1',
      status: 'booked',
      when: { startsOn: '2026-10-08', startsAt: '2026-10-08T14:00:00.000Z', endsAt: null },
    });
  });

  it('cancels it, leaving the time where it was', () => {
    const cancel = read('dentist-cancelled.txt')!;
    expect(
      resolveAppointment({
        reading: cancel,
        candidates: [stored({ startsOn: '2026-10-08', startsAt: '2026-10-08T14:00:00.000Z' })],
        receivedAt: '2026-09-26T12:00:00Z',
        timezone: ZONE,
      }),
    ).toEqual({ action: 'update', id: 'a1', status: 'cancelled', when: null });
  });

  it('finds the one booking ahead for a cancellation that names nothing', () => {
    const bare: AppointmentExtraction = { ...booking, event: 'cancelled', reference: null, date: null, time: null };
    expect(
      resolveAppointment({
        reading: bare,
        candidates: [stored({ reference: null }), stored({ id: 'old', reference: null, startsOn: '2026-03-01' })],
        receivedAt: '2026-09-26T12:00:00Z',
        timezone: ZONE,
      }),
    ).toMatchObject({ action: 'update', id: 'a1', status: 'cancelled' });
    expect(
      resolveAppointment({ reading: bare, candidates: [], receivedAt: '2026-09-26T12:00:00Z', timezone: ZONE }),
    ).toEqual({ action: 'unmatched' });
  });

  it('lets an older email read later change nothing', () => {
    expect(
      resolveAppointment({
        reading: booking,
        candidates: [stored({ status: 'cancelled', asOf: '2026-09-26T12:00:00+00:00' })],
        receivedAt: '2026-09-20T12:00:00Z',
        timezone: ZONE,
      }),
    ).toEqual({ action: 'stale', id: 'a1' });
  });

  it('keeps two times on one day as two appointments', () => {
    const later: AppointmentExtraction = { ...booking, reference: null, time: '17:00' };
    expect(
      resolveAppointment({
        reading: later,
        candidates: [stored({ reference: null })],
        receivedAt: '2026-09-21T12:00:00Z',
        timezone: ZONE,
      }),
    ).toMatchObject({ action: 'insert' });
  });
});

/**
 * The two halves of the day agreeing.
 *
 * The panel sends a word because the shell has no idea which day it is on the
 * account's list; app/todo/actions.ts turns that word into a date with the
 * account's timezone in hand. Nothing checks that they use the same words, so
 * this does -- a chip that sent "Today" while the action read "today" would
 * file every dated capture with no date at all and say nothing about it.
 */
import { describe, expect, it } from 'vitest';
import { isCalendarDay, todoCaptureForm } from '@/lib/capture/todo';
import { resolveRelativeDay } from '@/lib/todo/tasks/model';

/** What `parse` in app/todo/actions.ts does with the form, day-wise. */
function dayFiled(form: FormData, today: string): string {
  return resolveRelativeDay(String(form.get('dueOn') ?? ''), today);
}

describe('the form capture sends the todo module', () => {
  it('carries the title as typed', () => {
    expect(todoCaptureForm('Ring the dentist', '').get('title')).toBe('Ring the dentist');
  });

  it('files no day when no day was picked', () => {
    const form = todoCaptureForm('Ring the dentist', '');
    expect(form.get('dueOn')).toBeNull();
    expect(dayFiled(form, '2026-03-10')).toBe('');
  });

  it('files the day the chip means, once the zone is known', () => {
    expect(dayFiled(todoCaptureForm('Ring the dentist', 'today'), '2026-03-10')).toBe('2026-03-10');
    expect(dayFiled(todoCaptureForm('Ring the dentist', 'tomorrow'), '2026-03-10')).toBe(
      '2026-03-11',
    );
  });

  it('files a day picked in the field as the day it already is', () => {
    // A date means that date in any zone, so it passes straight through
    // rather than being resolved against the account's today.
    const form = todoCaptureForm('Ring the dentist', '2026-04-01');
    expect(form.get('dueOn')).toBe('2026-04-01');
    expect(dayFiled(form, '2026-03-10')).toBe('2026-04-01');
  });

  it('files no day for half a date typed into the field', () => {
    // A native date field reports a partly-typed date as an empty string, but
    // nothing about the type stops something else reaching here, and "2026-04"
    // filed as a due date is "That is not a date." on a thought somebody was
    // still in the middle of writing down.
    for (const half of ['2026-04', '2026', 'next tuesday', 'Today']) {
      expect(todoCaptureForm('Ring the dentist', half).get('dueOn')).toBeNull();
    }
  });
});

describe('isCalendarDay', () => {
  it('is a full YYYY-MM-DD and nothing else', () => {
    expect(isCalendarDay('2026-04-01')).toBe(true);
    expect(isCalendarDay('')).toBe(false);
    expect(isCalendarDay('2026-4-1')).toBe(false);
    expect(isCalendarDay('today')).toBe(false);
  });
});

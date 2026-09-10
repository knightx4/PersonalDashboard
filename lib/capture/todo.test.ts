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
import { todoCaptureForm } from '@/lib/capture/todo';
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
});

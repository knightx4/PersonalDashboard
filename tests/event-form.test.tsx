/**
 * The form that puts an event in the calendar.
 *
 * The joint being tested is the field names: app/todo/calendar/actions.ts
 * reads them out of the FormData by hand, so a renamed input is a field that
 * silently arrives empty rather than a type error. The hidden view and day are
 * the other half of it -- they are how saving returns you to what you were
 * looking at.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventForm, type EventDraft } from '@/components/todo/event-form';

const NEW: EventDraft = {
  id: null,
  title: '',
  body: '',
  location: '',
  allDay: false,
  startDay: '2026-03-10',
  endDay: '',
  startTime: '15:00',
  endTime: '16:00',
};

function render(draft: EventDraft = NEW) {
  return renderToStaticMarkup(<EventForm draft={draft} view="week" anchor="2026-03-09" />);
}

describe('EventForm', () => {
  it('sends every field the add action reads', () => {
    const html = render();
    for (const field of [
      'title',
      'startDay',
      'endDay',
      'startTime',
      'endTime',
      'allDay',
      'location',
      'body',
    ]) {
      expect(html).toContain(`name="${field}"`);
    }
  });

  it('opens on the day it was asked for, at the next whole hour', () => {
    const html = render();
    expect(html).toContain('name="startDay" value="2026-03-10"');
    expect(html).toContain('name="startTime" value="15:00"');
    expect(html).toContain('name="endTime" value="16:00"');
  });

  it('carries the view and day back with it', () => {
    const html = render();
    expect(html).toContain('name="view" value="week"');
    expect(html).toContain('name="date" value="2026-03-09"');
    expect(html).toContain('href="/todo/calendar?view=week&amp;date=2026-03-09"');
  });

  it('starts on the clock rather than all day', () => {
    // The times are hidden rather than unmounted when all day is ticked, so
    // what is typed survives ticking it twice.
    const html = render();
    expect(html).toContain('name="allDay"');
    expect(html).not.toContain('sm:grid-cols-2 hidden');
  });

  it('offers no delete for an event that does not exist yet', () => {
    expect(render()).not.toContain('Delete');
    expect(render()).not.toContain('name="id"');
  });

  it('fills itself in from a stored event, and offers to delete it', () => {
    const html = render({
      id: 'e-1',
      title: 'Half term',
      body: 'Ferry booked.',
      location: 'Whitstable',
      allDay: true,
      startDay: '2026-03-10',
      endDay: '2026-03-14',
      startTime: '',
      endTime: '',
    });

    expect(html).toContain('name="id" value="e-1"');
    expect(html).toContain('value="Half term"');
    expect(html).toContain('name="endDay" value="2026-03-14"');
    expect(html).toContain('value="Whitstable"');
    expect(html).toContain('Ferry booked.');
    expect(html).toContain('Delete');
    // Ticked, so the time fields are out of the way.
    expect(html).toContain('sm:grid-cols-2 hidden');
  });
});

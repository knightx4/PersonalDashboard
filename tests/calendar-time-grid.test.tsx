/**
 * The day and week grid, and the one thing on it that has a length.
 *
 * An event is drawn over the hours it runs; everything else on the calendar is
 * a moment and stays a line in its hour. The rows a block covers, and the lanes
 * two clashing meetings take, are the two things that can be quietly wrong here
 * -- a block an hour too long looks exactly like a correct one.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarTimeGrid } from '@/components/todo/calendar-time-grid';
import type { CalendarDay, CalendarEntry } from '@/lib/todo/calendar/month';

function entry(over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    key: 'event:e1',
    kind: 'event',
    at: null,
    end: null,
    eventId: 'e1',
    feedEventId: null,
    title: 'An event',
    href: null,
    done: false,
    ...over,
  };
}

function day(entries: CalendarEntry[], over: Partial<CalendarDay> = {}): CalendarDay {
  return { day: '2026-03-10', inMonth: true, isToday: false, entries, ...over };
}

function render(days: CalendarDay[]) {
  return renderToStaticMarkup(
    <CalendarTimeGrid
      days={days}
      timezone="UTC"
      newEventHref={(day) => `/todo/calendar?new=${day}`}
      eventHref={(id) => `/todo/calendar?event=${id}`}
      feedEventHref={(id) => `/todo/calendar?feedEvent=${id}`}
    />,
  );
}

/** The blocks in the markup, as the grid rows and lane widths they were given. */
function blocks(html: string): Array<{ row: string; width: string; marginLeft: string }> {
  return [...html.matchAll(/style="([^"]*grid-row:[^"]*)"/g)]
    .map((match) => match[1])
    .filter((style) => style.includes('width'))
    .map((style) => ({
      row: /grid-row:([^;]*)/.exec(style)?.[1].trim() ?? '',
      width: /width:([^;]*)/.exec(style)?.[1].trim() ?? '',
      marginLeft: /margin-left:([^;]*)/.exec(style)?.[1].trim() ?? '',
    }));
}

describe('CalendarTimeGrid', () => {
  it('draws a two-hour meeting over the two rows it runs', () => {
    // The grid opens at 08:00, so 10:00 is the third row and the block ends
    // where the 12:00 row starts.
    const html = render([
      day([
        entry({
          title: 'Design review',
          at: '2026-03-10T10:00:00.000Z',
          end: '2026-03-10T12:00:00.000Z',
        }),
      ]),
    ]);

    expect(blocks(html)).toEqual([{ row: '3 / 5', width: '100%', marginLeft: '0%' }]);
    expect(html).toContain('Design review');
  });

  it('gives something shorter than an hour a row of its own', () => {
    const html = render([
      day([
        entry({ title: 'Standup', at: '2026-03-10T09:00:00.000Z', end: '2026-03-10T09:15:00.000Z' }),
      ]),
    ]);

    expect(blocks(html)).toEqual([{ row: '2 / 3', width: '100%', marginLeft: '0%' }]);
  });

  it('puts two meetings that clash side by side, both of them visible', () => {
    const html = render([
      day([
        entry({
          key: 'event:a',
          title: 'Interview',
          at: '2026-03-10T10:00:00.000Z',
          end: '2026-03-10T12:00:00.000Z',
        }),
        entry({
          key: 'event:b',
          title: 'Dentist',
          at: '2026-03-10T11:00:00.000Z',
          end: '2026-03-10T12:00:00.000Z',
        }),
      ]),
    ]);

    expect(blocks(html)).toEqual([
      { row: '3 / 5', width: '50%', marginLeft: '0%' },
      { row: '4 / 5', width: '50%', marginLeft: '50%' },
    ]);
    expect(html).toContain('Interview');
    expect(html).toContain('Dentist');
  });

  it('draws nothing with a length for a task, an interview or a deadline', () => {
    const html = render([
      day([
        entry({ key: 'task:t1', kind: 'task', title: 'Ring the bank', at: '2026-03-10T14:00:00.000Z' }),
        entry({ key: 'context:i1', kind: 'context', title: 'Acme · first round', at: '2026-03-10T15:00:00.000Z' }),
      ]),
    ]);

    expect(blocks(html)).toEqual([]);
    expect(html).toContain('Ring the bank');
    expect(html).toContain('Acme · first round');
  });

  it('keeps an all-day event out of the hours and in the all-day row', () => {
    const html = render([day([entry({ title: 'Bank holiday' })])]);

    expect(blocks(html)).toEqual([]);
    expect(html).toContain('All day');
    expect(html).toContain('Bank holiday');
  });

  it('widens the hours so a late meeting is not drawn past the bottom', () => {
    // The band stops at 18:00 by default. A meeting running to 21:00 has to
    // bring the rows with it, or it would be laid out over hours that are not
    // drawn. The last row it needs is 20:00, the hour it is still in.
    const html = render([
      day([
        entry({ title: 'Late one', at: '2026-03-10T17:00:00.000Z', end: '2026-03-10T21:00:00.000Z' }),
      ]),
    ]);

    expect(html).toContain('20:00');
    expect(html).not.toContain('21:00');
    expect(blocks(html)).toEqual([{ row: '10 / 14', width: '100%', marginLeft: '0%' }]);
  });

  it('opens a subscribed appointment to be read, not to be edited', () => {
    // The two kinds of appointment lead different places, and the difference
    // is the whole point: one opens the form that wrote it, the other a card
    // that cannot write at all.
    const html = render([
      day([
        entry({
          key: 'feed:f1',
          kind: 'feed',
          eventId: null,
          feedEventId: 'f1',
          title: 'Sprint review',
          at: '2026-03-10T10:00:00.000Z',
          end: '2026-03-10T11:00:00.000Z',
        }),
      ]),
    ]);

    expect(html).toContain('/todo/calendar?feedEvent=f1');
    expect(html).not.toContain('/todo/calendar?event=f1');
  });

  it('scrolls a week sideways rather than shrinking it to seven columns', () => {
    const week = Array.from({ length: 7 }, (_, index) =>
      day([], { day: `2026-03-${String(9 + index).padStart(2, '0')}` }),
    );
    expect(render(week)).toContain('min-width:42rem');
    expect(render([day([])])).not.toContain('min-width');
  });
});

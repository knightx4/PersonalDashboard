/**
 * The raised page, rendered.
 *
 * Two claims about markup that no test on the loader can see: a raise that
 * named what a yes does must show it under the ask and offer yes and no, and a
 * raise filed before there was a column for it must read exactly as it did —
 * the story and the answer box, no empty label and no buttons for an action
 * that does not exist.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { raisedQueueFrom, raisedRowFrom, type RaisedRow } from '@/lib/raised/load';

// The server actions pull in the session client, which has no business in a
// render test; the view only needs them to exist to hand to its forms.
vi.mock('@/app/dev/raised/actions', () => {
  const noop = async () => ({});
  return { answerRaise: noop, decideRaise: noop, dismissRaise: noop, reopenRaise: noop };
});

const { RaisedView } = await import('@/app/dev/raised/raised-view');

function raise(over: Record<string, unknown> = {}): RaisedRow {
  return raisedRowFrom({
    id: 'r1',
    title: 'Two sessions were sent at plan step #342 at the same time',
    detail: 'Both runs claimed it within the same minute.',
    ask: 'Should Send to Claude refuse a step whose feature is already being worked?',
    consequence: null,
    module: 'dev',
    source: 'plan #342',
    status: 'open',
    created_at: '2026-09-13T04:57:00.000Z',
    answered_at: null,
    ...over,
  });
}

function render(rows: RaisedRow[]): string {
  return renderToStaticMarkup(<RaisedView queue={raisedQueueFrom(rows)} />);
}

describe('a raise on the page', () => {
  it('says what answering yes does, and offers yes and no', () => {
    const html = render([
      raise({
        consequence: {
          name: 'file_idea',
          text: 'Refuse a second session on a step already being worked',
          module: null,
          field: null,
        },
      }),
    ]);

    expect(html).toContain('Answering yes');
    expect(html).toContain('Refuse a second session on a step already being worked');
    expect(html).toContain('Yes, do it');
    expect(html).toContain('>No</button>');
    expect(html).toContain('Yes, and…');
    // The box for those extra words is closed until it is asked for, so a page
    // of raises is not a page of textareas.
    expect(html).not.toContain('Anything the action above does not cover');
  });

  it('shows neither for a raise filed before it said what a yes does', () => {
    const html = render([raise()]);

    expect(html).not.toContain('Answering yes');
    expect(html).not.toContain('Yes, do it');
    expect(html).toContain(
      'Should Send to Claude refuse a step whose feature is already being worked?',
    );
  });

  // Answered and dismissed rows are history: the action either ran or it did
  // not, and a button that would run it again does not belong on them.
  it('offers no yes on a raise that is already closed', () => {
    const html = render([
      raise({
        status: 'answered',
        answered_at: '2026-09-13T05:00:00.000Z',
        consequence: { name: 'file_idea', text: 'Refuse a second session', module: null },
      }),
    ]);

    expect(html).toContain('Answering yes');
    expect(html).not.toContain('Yes, do it');
  });
});

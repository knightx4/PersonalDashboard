/**
 * The box a comment is sent from.
 *
 * What the markup has to say and no test on the actions can see: the send
 * control is inside the box with the words rather than under it, it is off
 * until something is typed, and it carries the caller's own name for it --
 * "Answer and reopen" on a blocked bug note -- because there is no text on the
 * glyph to read. Nothing here presses a key: there is no DOM in this suite, so
 * Enter, shift-Enter and the IME guard are held by the handler alone.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CommentActionState } from '@/app/dev/comment-actions';
import { threadRef } from '@/lib/thread/subjects';

// The comment actions reach for the session client, which has no business in a
// render test. The thread only needs them to exist to hand to its forms.
vi.mock('@/app/dev/comment-actions', () => {
  const noop = async () => ({});
  return { addComment: noop, deleteComment: noop };
});
vi.mock('@/app/goals/[goalId]/comment-actions', () => {
  const noop = async () => ({});
  return { addGoalComment: noop, deleteGoalComment: noop };
});
vi.mock('@/app/goals/files/[fileId]/comment-actions', () => {
  const noop = async () => ({});
  return { addFileComment: noop, deleteFileCommentAction: noop };
});
vi.mock('@/app/jobs/(app)/roles/[id]/comment-actions', () => {
  const noop = async () => ({});
  return { addRoleComment: noop, deleteRoleComment: noop };
});

const { Thread } = await import('@/components/thread/thread');

const ROW = '00000000-0000-4000-8000-000000000001';

const respond = async (): Promise<CommentActionState> => ({});

function open(props: Partial<React.ComponentProps<typeof Thread>> = {}): string {
  return renderToStaticMarkup(
    <Thread subject={threadRef('step', ROW)} turns={[]} composerOpen {...props} />,
  );
}

describe('the open box', () => {
  it('sends from inside itself, with nothing standing underneath', () => {
    const html = open();

    // The box's own border, then the words, then the control -- in that order
    // and with only the words' own row closed in between (it carries Dash's
    // tag button beside them, note 66f5a513), which is what puts the send
    // inside the box rather than under it.
    const border = html.indexOf('border-control');
    const words = html.indexOf('<textarea');
    const send = html.indexOf('Send</span>');
    expect(border).toBeGreaterThan(-1);
    expect(border).toBeLessThan(words);
    expect(send).toBeGreaterThan(words);
    expect(html.slice(words, send).match(/<\/div>/g)).toHaveLength(1);

    // The pair that used to sit below the form. Cancel has no replacement: the
    // way out is Escape, or leaving an empty box.
    expect(html).not.toContain('>Cancel<');
  });

  it('keeps the send control off until something is typed', () => {
    const html = open();
    const send = html.lastIndexOf('<button', html.indexOf('Send</span>'));

    expect(html.slice(send, html.indexOf('Send</span>'))).toContain('disabled');
  });

  it('is named by the caller that overrides where it writes', () => {
    const html = open({ submit: { action: respond, label: 'Answer and reopen' } });

    expect(html).toContain('Answer and reopen</span>');
    expect(html).toContain('title="Answer and reopen"');
    expect(html).not.toContain('Send</span>');
    // Nothing here is reading the tag, so neither the line about it nor the
    // control that writes it belongs in the foot row.
    expect(html).not.toContain('Tag @dash');
    expect(html).not.toContain('Nothing reads it');
  });

  it('says whether a plain comment reaches Dash, and offers the tag', () => {
    const html = open();

    expect(html).toContain('A note on the row. Nothing reads it.');
    expect(html).toContain('Tag @dash');
    // Dash's head, left of the words, in its own circle (note 66f5a513).
    expect(html.indexOf('Tag @dash')).toBeLessThan(html.indexOf('<textarea'));
    expect(html).toContain('rounded-full');
    expect(html).toContain('aria-pressed="false"');
  });

  it('lights the tag button once the comment reaches Dash', () => {
    const html = open({ subject: threadRef('raise', ROW) });

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Dash will read this');
  });
});

describe('the closed box', () => {
  it('is a trigger until it is pressed', () => {
    const html = renderToStaticMarkup(<Thread subject={threadRef('step', ROW)} turns={[]} />);

    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('Send</span>');
    expect(html).toContain('Add a comment');
  });
});

describe('a grouped message', () => {
  const run = [
    { id: 'a', author: 'claude' as const, body: 'First of the run.', createdAt: '2026-09-10T09:00:00Z' },
    { id: 'b', author: 'claude' as const, body: 'Second of the run.', createdAt: '2026-09-10T09:05:00Z' },
  ];

  it('carries a short time in the strip, with the whole one on the title', () => {
    const html = renderToStaticMarkup(<Thread subject={threadRef('step', ROW)} turns={run} />);

    // The clock reads zero on a server render, so both times are the date.
    expect(html).toContain('title="2026-09-10 09:05"');
    expect(html).toContain('>10 Sep</time>');
    // Out of the flow, so the 16px column does not grow when it appears.
    expect(html).toContain('absolute');

    // The first of the run keeps the header it has, in the wording it had.
    expect(html).toContain('>Dash</span>');
    expect(html).toContain('>2026-09-10</time>');
  });

  it('leaves the strip to the author mark when nothing is grouped', () => {
    const html = renderToStaticMarkup(
      <Thread subject={threadRef('step', ROW)} turns={[run[0]!]} />,
    );

    expect(html).not.toContain('>10 Sep</time>');
  });
});

describe('one thread for any row', () => {
  it('posts the row its ref names, with the ref beside it', () => {
    const html = open({ subject: threadRef('role', ROW) });

    expect(html).toContain('name="target" value="role"');
    expect(html).toContain(`name="id" value="${ROW}"`);
    expect(html).toContain(`name="subject" value="job_search.roles:${ROW}"`);
  });

  it('offers the tag wherever Dash answers, and not on a file', () => {
    for (const target of ['step', 'idea', 'goal', 'role'] as const) {
      expect(open({ subject: threadRef(target, ROW) })).toContain('Tag @dash');
    }

    const file = open({ subject: threadRef('file', ROW) });
    expect(file).not.toContain('Tag @dash');
    expect(file).toContain('Dash reads it before revising the file.');
  });

  it('says a raise is an answer, tagged or not', () => {
    expect(open({ subject: threadRef('raise', ROW) })).toContain('This is your answer.');
  });

  it('will not draw a thread under a table that has none', () => {
    expect(() => open({ subject: `public.orders:${ROW}` })).toThrow(/not a row that has a thread/);
  });
});

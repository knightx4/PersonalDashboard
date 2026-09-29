/**
 * The changes Dash proposes, as cards under its answer (plan #1190): what
 * each says in each state, and that a reopened thread puts each card under
 * the answer that proposed it.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskDashProvider, AskThread, type AskSource } from '@/components/shell/ask-dash';
import { DashChanges } from '@/components/talk/dash-changes';
import { MadeChanges } from '@/components/talk/made-changes';
import { changeHref, changeSentence, dueDay } from '@/lib/ask/change-view';
import type { DashChange, MadeChange } from '@/lib/talk/changes';
import type { TalkTurn } from '@/lib/talk/talk';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ask',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const never = () => new Promise<never>(() => {});
const SOURCE: AskSource = {
  ask: never,
  recent: never,
  open: never,
  costs: never,
  confirm: never,
  decline: never,
  undo: never,
};

const BASE = {
  conversationId: 'c',
  turnId: 'a1',
  writtenTable: null,
  writtenRef: null,
  undo: null,
  createdAt: '2026-09-29T10:00:00Z',
  confirmedAt: null,
  declinedAt: null,
  undoneAt: null,
} as const;

const TODO: DashChange = {
  ...BASE,
  id: 'todo',
  status: 'proposed',
  kind: 'add_todo',
  input: { title: 'Call the dentist', body: null, dueOn: '2026-10-02', dueTime: null, pinned: false },
};
const STEP: DashChange = {
  ...BASE,
  id: 'step',
  status: 'proposed',
  kind: 'add_goal_step',
  input: { parentId: 'g1', goalTitle: 'Get fit', title: 'Book a class', kind: 'mine' },
};
const RETURN: DashChange = {
  ...BASE,
  id: 'ret',
  status: 'proposed',
  kind: 'mark_returned',
  input: { id: 'i1', itemTitle: 'Blue kettle' },
};

const draw = (changes: DashChange[]) =>
  renderToStaticMarkup(<DashChanges changes={changes} presses={SOURCE} today="2026-09-29" />);

describe('the words on a card', () => {
  it('says the due day as a weekday and date, with the year only when it differs', () => {
    expect(dueDay('2026-10-02', '2026-09-29')).toBe('Friday 2 October');
    expect(dueDay('2027-01-08', '2026-09-29')).toBe('Friday 8 January 2027');
  });

  it('says what each kind will write, and what it wrote', () => {
    expect(changeSentence(TODO, false, '2026-09-29')).toBe('Add the todo Call the dentist, due Friday 2 October');
    expect(changeSentence(TODO, true, '2026-09-29')).toBe('Added the todo Call the dentist, due Friday 2 October');
    expect(changeSentence(STEP, false)).toBe('Add the step Book a class under Get fit');
    expect(changeSentence(RETURN, true)).toBe('Marked Blue kettle returned, with a full refund');
  });
});

describe('a card in each state', () => {
  it('offers Confirm and Decline while proposed, and links nothing', () => {
    const html = draw([TODO]);
    expect(html).toContain('Confirm');
    expect(html).toContain('Decline');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('Undo');
  });

  it('links to the row once confirmed, with an Undo', () => {
    const confirmed: DashChange = { ...TODO, status: 'confirmed', writtenTable: 'todo.tasks', writtenRef: 't9' };
    const html = draw([confirmed]);
    expect(html).toContain(`href="${changeHref(confirmed).replace(/&/g, '&amp;')}"`);
    expect(html).toContain('/todo/all?status=all&amp;focus=t9');
    expect(html).toContain('Added the todo');
    expect(html).toContain('Undo');
    expect(html).not.toContain('Confirm');
  });

  it('says a declined change wrote nothing, and offers no button', () => {
    const html = draw([{ ...TODO, status: 'declined' }]);
    expect(html).toContain('Declined');
    expect(html).toContain('Nothing was written.');
    expect(html).not.toContain('<button');
  });

  it('says an undone change was taken back, and offers no button', () => {
    const html = draw([{ ...TODO, status: 'undone', writtenRef: 't9' }]);
    expect(html).toContain('Undone');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('href=');
  });

  it('never names the assistant anything but Dash', () => {
    expect(draw([TODO, STEP, RETURN])).not.toMatch(/claude/i);
  });
});

describe('a reopened conversation', () => {
  const turns: TalkTurn[] = [
    { id: 'q1', role: 'user', body: 'Add a todo to call the dentist', createdAt: '2026-09-29T10:00:00Z' },
    { id: 'a1', role: 'assistant', body: 'I can add that.', createdAt: '2026-09-29T10:00:05Z' },
    { id: 'q2', role: 'user', body: 'And a step to book a class', createdAt: '2026-09-29T10:01:00Z' },
    { id: 'a2', role: 'assistant', body: 'I can add that too.', createdAt: '2026-09-29T10:01:05Z' },
  ];

  it('draws each card under the answer that proposed it, in its current state', () => {
    const html = renderToStaticMarkup(
      <AskDashProvider source={SOURCE}>
        <AskThread
          id="t"
          conversationRef="c"
          turns={turns}
          changes={[
            { ...TODO, status: 'declined' },
            { ...STEP, turnId: 'a2', status: 'confirmed', writtenTable: 'goals.items', writtenRef: 's1' },
          ]}
          label="Ask a follow-up"
        />
      </AskDashProvider>,
    );
    const first = html.indexOf('I can add that.');
    const declined = html.indexOf('Nothing was written.');
    const second = html.indexOf('I can add that too.');
    const step = html.indexOf('/goals/g1#step-s1');
    expect(first).toBeGreaterThan(-1);
    expect(declined).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(declined);
    expect(step).toBeGreaterThan(second);
  });
});

describe('the changes Dash made, on the Ask page', () => {
  const made = (change: DashChange, question: string | null, at: string): MadeChange => ({
    ...change,
    status: 'confirmed',
    writtenTable: 'x',
    writtenRef: `${change.id}-row`,
    createdAt: at,
    confirmedAt: at,
    question,
  });
  const list: MadeChange[] = [
    { ...made(RETURN, 'I sent the kettle back', '2026-09-29T12:00:00Z'), conversationId: 'c3' },
    { ...made(STEP, null, '2026-09-29T11:00:00Z'), conversationId: 'c2', status: 'undone' },
    { ...made(TODO, 'Add a todo to call the dentist', '2026-09-29T10:00:00Z'), conversationId: 'c1' },
  ];
  const html = renderToStaticMarkup(<MadeChanges changes={list} presses={SOURCE} today="2026-09-29" />);

  it('lists every kind in the order given, newest first', () => {
    const at = (text: string) => html.indexOf(text);
    expect(at('Blue kettle')).toBeGreaterThan(-1);
    expect(at('Blue kettle')).toBeLessThan(at('Book a class'));
    expect(at('Book a class')).toBeLessThan(at('Call the dentist'));
  });

  it('links each standing change to its row, and each to the question it came from', () => {
    expect(html).toContain('href="/shopping/inventory/i1"');
    expect(html).toContain('href="/todo/all?status=all&amp;focus=todo-row"');
    expect(html).toContain('href="/ask/c3"');
    expect(html).toContain('>I sent the kettle back</a>');
    expect(html).toContain('href="/ask/c2"');
    expect(html).toContain('>a question</a>');
  });

  it('offers Undo on a standing change only, and says an undone one was taken back', () => {
    expect(html.match(/Undo<\/button>/g) ?? []).toHaveLength(2);
    expect(html).toContain('It was taken back.');
    expect(html).not.toContain('href="/goals/g1');
  });

  it('draws nothing when there are none', () => {
    expect(renderToStaticMarkup(<MadeChanges changes={[]} presses={SOURCE} />)).toBe('');
  });

  it('never names the assistant anything but Dash', () => {
    expect(html).not.toMatch(/claude/i);
  });
});

/**
 * A question from Goals on Todo draws its options as buttons, the recommended
 * one marked, and a question with none draws as the plain linked row it was
 * (plan #1267).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgendaItem } from '@/lib/todo/agenda/sources';

vi.mock('@/app/todo/source-actions', () => ({
  answerItem: vi.fn(),
  completeItem: vi.fn(),
  deferItem: vi.fn(),
  dismissItem: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { AgendaItemRow } = await import('@/components/todo/agenda-item-row');

const question: AgendaItem = {
  key: 'goal_questions:q1',
  source: 'goal_steps',
  ref: 'goals.items:q1',
  title: 'Which bank?',
  day: '2026-09-29',
  at: null,
  link: { href: '/goals/g#step-q1', label: 'Open a savings account' },
  action: null,
  detail: 'Waiting on your answer',
  completable: false,
};

describe('AgendaItemRow for a question', () => {
  it('draws a button per option and marks the recommended one', () => {
    const html = renderToStaticMarkup(
      <AgendaItemRow
        timezone="UTC"
        item={{
          ...question,
          options: [
            { letter: 'A', label: 'The local one', answer: 'A — The local one', recommended: false },
            { letter: 'B', label: 'The online one', answer: 'B — The online one', recommended: true },
          ],
        }}
      />,
    );
    expect(html).toContain('title="Answer A: The local one"');
    expect(html).toContain('title="Answer B: The online one (recommended)"');
    expect(html).toContain('ring-positive/50');
    expect(html).not.toContain('Mark done');
  });

  it('draws no buttons for a question without options, only the link to it', () => {
    const html = renderToStaticMarkup(<AgendaItemRow timezone="UTC" item={question} />);
    expect(html).not.toContain('Answer with');
    expect(html).toContain('href="/goals/g#step-q1"');
  });
});

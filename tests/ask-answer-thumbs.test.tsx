/**
 * Thumbs up and down under each Dash answer (plan #2285.2): drawn after Retry
 * and Edit, filled on an answer already rated, kept when a chat is reopened,
 * and left out where the answer cannot be rated.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskDashProvider, AskThread, type AskSource } from '@/components/shell/ask-dash';
import { AnswerActions } from '@/components/talk/answer-actions';
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
  poll: never,
  costs: never,
  label: never,
  confirm: never,
  decline: never,
  undo: never,
  save: never,
  rate: never,
};

/** The button named `label`, as markup. */
function button(html: string, label: string): string {
  const found = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  if (!found) throw new Error(`no ${label} button`);
  return found[0];
}

const presses = { body: 'Nothing is due.', question: 'What is due?', busy: false, onRetry: () => {}, onEdit: () => {} };

describe('the thumbs under an answer', () => {
  it('draws both unpressed after Retry and Edit, with no What went wrong? box', () => {
    const html = renderToStaticMarkup(<AnswerActions {...presses} rate={never} />);
    expect(button(html, 'Thumbs up')).toContain('aria-pressed="false"');
    expect(button(html, 'Thumbs down')).toContain('aria-pressed="false"');
    expect(html.indexOf('Edit the question')).toBeLessThan(html.indexOf('Thumbs up'));
    expect(html).not.toContain('What went wrong?');
  });

  it('fills the thumb an answer was rated with', () => {
    const html = renderToStaticMarkup(
      <AnswerActions {...presses} rate={never} rated={{ rating: 'down', note: 'Wrong bill' }} />,
    );
    expect(button(html, 'Thumbs down')).toContain('aria-pressed="true"');
    expect(button(html, 'Thumbs up')).toContain('aria-pressed="false"');
    expect(html).toContain('fill="currentColor"');
  });

  it('is left out where the answer cannot be rated yet', () => {
    const html = renderToStaticMarkup(<AnswerActions {...presses} />);
    expect(html).not.toContain('Thumbs up');
    expect(html).not.toContain('Thumbs down');
  });
});

describe('a reopened chat', () => {
  const turns: TalkTurn[] = [
    { id: 'q1', role: 'user', body: 'What is due?', createdAt: '2026-10-17T09:00:00Z' },
    { id: 'a1', role: 'assistant', body: 'Nothing is due.', createdAt: '2026-10-17T09:00:05Z', rating: 'up' },
    { id: 'q2', role: 'user', body: 'And next week?', createdAt: '2026-10-17T09:01:00Z' },
    { id: 'a2', role: 'assistant', body: 'The rent.', createdAt: '2026-10-17T09:01:05Z' },
  ];

  it('shows each answer’s thumb as it was left', () => {
    const html = renderToStaticMarkup(
      <AskDashProvider source={SOURCE}>
        <AskThread id="t" conversationRef="c" turns={turns} label="Ask a follow-up" />
      </AskDashProvider>,
    );
    const ups = html.match(/<button[^>]*aria-label="Thumbs up"[^>]*>/g) ?? [];
    expect(ups).toHaveLength(2);
    expect(ups[0]).toContain('aria-pressed="true"');
    expect(ups[1]).toContain('aria-pressed="false"');
  });

  it('has no thumbs before the chat is kept', () => {
    const html = renderToStaticMarkup(
      <AskDashProvider source={SOURCE}>
        <AskThread id="t" conversationRef={null} turns={turns} label="Ask a follow-up" />
      </AskDashProvider>,
    );
    expect(html).not.toContain('Thumbs up');
  });
});

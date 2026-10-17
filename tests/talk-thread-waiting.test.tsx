/**
 * While Dash answers, the chat shows your reply and a loading line, and
 * Dash's previous message is drawn once (plan #2262.1). The words of the last
 * answer outlived it into the next question's waiting line, so the thread
 * read as Dash saying it again under what you had just written.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { replyOnItsWay, Thread } from '@/components/thread/thread';
import { AskDashProvider, AskThread, type AskSource } from '@/components/shell/ask-dash';
import type { TalkTurn } from '@/lib/talk/talk';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ask',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

function turn(id: string, role: TalkTurn['role'], body: string): TalkTurn {
  return { id, role, body, createdAt: '2026-10-16T09:00:00.000Z' } as TalkTurn;
}

const LAST = 'You spent 412 pounds at the supermarket in September.';
const TURNS = [turn('q1', 'user', 'What did I spend on food?'), turn('a1', 'assistant', LAST)];
const REPLY = 'And in August?';

const count = (html: string, text: string) => html.split(text).length - 1;

function midSend(written = ''): string {
  return renderToStaticMarkup(
    <Thread
      id="t"
      turns={TURNS}
      send={async () => ({})}
      label="Ask"
      waiting="Looking it up…"
      written={written}
      pendingQuestion={REPLY}
    />,
  );
}

describe('a chat with a reply on its way', () => {
  it('shows your reply and the loading line, and the last answer once', () => {
    const html = midSend();
    expect(count(html, LAST)).toBe(1);
    expect(html).toContain(REPLY);
    expect(html).toContain('Looking it up…');
    expect(html.indexOf(LAST)).toBeLessThan(html.indexOf(REPLY));
    expect(html.indexOf(REPLY)).toBeLessThan(html.indexOf('Looking it up…'));
  });

  it('does not draw the last answer again when its words are still held', () => {
    const html = midSend(LAST);
    expect(count(html, LAST)).toBe(1);
    expect(html).toContain('Looking it up…');
  });

  it('draws only the new words when they arrive after the old ones', () => {
    const html = midSend(`${LAST}In August`);
    expect(count(html, LAST)).toBe(1);
    expect(html).toContain('In August');
    expect(html).not.toContain('Looking it up…');
  });

  it('does the same in the Ask Dash chat', () => {
    const never = () => new Promise<never>(() => {});
    const source: AskSource = {
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
    const html = renderToStaticMarkup(
      <AskDashProvider source={source}>
        <AskThread id="t" conversationRef="c" turns={TURNS} label="Ask" pendingQuestion={REPLY} />
      </AskDashProvider>,
    );
    expect(count(html, LAST)).toBe(1);
    expect(html).toContain(REPLY);
    expect(html).toContain('Dash is looking it up.');
  });
});

describe('the words held for the answer on its way', () => {
  it('keeps words that do not open with the last answer', () => {
    expect(replyOnItsWay('In August', TURNS)).toBe('In August');
    expect(replyOnItsWay('Anything', [turn('q', 'user', 'hi')])).toBe('Anything');
  });

  it('leaves out the last answer when they open with it', () => {
    expect(replyOnItsWay(LAST, TURNS)).toBe('');
    expect(replyOnItsWay(`${LAST} In August`, TURNS)).toBe('In August');
  });
});

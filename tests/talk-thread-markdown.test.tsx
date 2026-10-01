/**
 * A reply from Dash in a conversation, rendered as the markdown it is written
 * in, while what you typed stays as you typed it (note 7cf4109a).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TalkThread } from '@/components/talk/talk-thread';
import type { TalkTurn } from '@/lib/talk/talk';

function turn(id: string, role: TalkTurn['role'], body: string): TalkTurn {
  return { id, role, body, createdAt: '2026-10-01T09:00:00.000Z' } as TalkTurn;
}

function render(turns: TalkTurn[]): string {
  return renderToStaticMarkup(
    <TalkThread id="t" turns={turns} send={async () => ({})} label="Ask" />,
  );
}

describe('a conversation with Dash', () => {
  it('renders the reply as markdown', () => {
    const html = render([
      turn('a', 'assistant', 'You have **three** things due:\n\n- Rent\n- Gym\n- #3 on the list'),
    ]);
    expect(html).toContain('<strong>three</strong>');
    expect(html).toMatch(/<ul>\s*<li>Rent<\/li>/);
    // A number in a reply is not a plan step.
    expect(html).not.toContain('href="/dev/plan');
  });

  it('leaves what you typed as you typed it', () => {
    const html = render([turn('q', 'user', 'what is **due**?')]);
    expect(html).toContain('what is **due**?');
  });
});

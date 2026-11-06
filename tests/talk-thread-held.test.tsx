/**
 * A question sent while Dash is answering (plan #2988.2) is held in the
 * thread under the answer being written, and goes once that answer lands.
 * Stop stays in the box, and Send comes back beside it once words are typed.
 * The timing (the pause, the batch) is lib/talk/held.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thread } from '@/components/thread/thread';
import type { TalkTurn } from '@/lib/talk/talk';

const at = '2026-11-06T09:00:00.000Z';
const TURNS: TalkTurn[] = [
  { id: 'q1', role: 'user', body: 'What did I spend on food?', createdAt: at },
  { id: 'a1', role: 'assistant', body: 'You spent 412 pounds in September.', createdAt: at },
];
const ASKED = 'And in August?';
const HELD = 'And on takeaways alone?';

function midAnswer(draft = ''): string {
  return renderToStaticMarkup(
    <Thread
      id="t"
      turns={TURNS}
      send={async () => ({})}
      label="Ask"
      waiting="Looking it up…"
      pendingQuestion={ASKED}
      heldQuestions={[HELD]}
      together
      onStop={() => {}}
      startWriting
      initialDraft={draft}
    />,
  );
}

describe('a question sent while Dash answers', () => {
  it('is held under the answer being written, not above it', () => {
    const html = midAnswer();
    expect(html).toContain(HELD);
    expect(html.indexOf(ASKED)).toBeLessThan(html.indexOf('Looking it up…'));
    expect(html.indexOf('Looking it up…')).toBeLessThan(html.indexOf(HELD));
  });

  it('keeps Stop in the box, with Send beside it once words are typed', () => {
    const empty = midAnswer();
    expect(empty).toContain('aria-label="Stop"');
    expect(empty).not.toContain('title="Send"');
    const typed = midAnswer('And drinks?');
    expect(typed).toContain('aria-label="Stop"');
    expect(typed).toContain('title="Send"');
  });

  it('is not offered without together: Stop alone stands in for Send', () => {
    const html = renderToStaticMarkup(
      <Thread
        id="t"
        turns={TURNS}
        send={async () => ({})}
        label="Ask"
        pendingQuestion={ASKED}
        onStop={() => {}}
        startWriting
        initialDraft="And drinks?"
      />,
    );
    expect(html).toContain('aria-label="Stop"');
    expect(html).not.toContain('title="Send"');
  });
});

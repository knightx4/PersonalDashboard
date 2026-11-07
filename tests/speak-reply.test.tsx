/**
 * Read aloud on a chat reply (plan #3006.1): the press under each answer,
 * Stop while it plays, the speaking switch, and why a reply was not read
 * said under it in the route's words.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerActions } from '@/components/talk/answer-actions';
import { SpeakSwitch, SpeechFixture } from '@/components/talk/speak-reply';
import { SPEAK_MESSAGES } from '@/lib/talk/speech/speak';
import { SPEAK_HELD_BACK, type SpeechState } from '@/lib/talk/speech/player';

const presses = { body: 'Nothing is due.', question: 'What is due?', busy: false, onRetry: () => {}, onEdit: () => {} };

function drawn(state: SpeechState, speaking = true) {
  return renderToStaticMarkup(
    <SpeechFixture.Provider value={{ speaking, state }}>
      <SpeakSwitch look="icon" />
      <AnswerActions {...presses} speak={{ id: 'a1', fresh: false }} />
    </SpeechFixture.Provider>,
  );
}

describe('Read aloud on an answer', () => {
  it('offers Read aloud, and leaves it out where the answer is not read aloud', () => {
    expect(renderToStaticMarkup(<AnswerActions {...presses} speak={{ id: 'a1', fresh: false }} />)).toContain(
      'aria-label="Read aloud"',
    );
    expect(renderToStaticMarkup(<AnswerActions {...presses} />)).not.toContain('Read aloud');
  });

  it('shows Stop while the answer plays', () => {
    const html = drawn({ key: 'a1', phase: 'playing', notes: {} });
    expect(html).toContain('aria-label="Stop reading"');
    expect(html).not.toContain('aria-label="Read aloud"');
  });

  it('says under the answer that voice is paused, and keeps the answer', () => {
    const html = drawn({ key: null, phase: 'idle', notes: { a1: SPEAK_MESSAGES.paused } });
    expect(html).toContain('Voice is paused until next month');
    // Speaking is on, so the answer carries its speaker, at rest (plan #3043).
    expect(html).toContain('aria-label="Play this reply again"');
    expect(drawn({ key: null, phase: 'idle', notes: {} }, false)).toContain('aria-label="Read aloud"');
  });

  it('greys the speaker of an answer the browser held back, with no second prompt under it (plan #3043)', () => {
    const html = drawn({ key: null, phase: 'idle', notes: { a1: SPEAK_HELD_BACK } });
    expect(html).toContain('Press to play this reply');
    expect(html).not.toContain(SPEAK_HELD_BACK);
    // With speaking off there is no speaker, so the note says it.
    expect(drawn({ key: null, phase: 'idle', notes: { a1: SPEAK_HELD_BACK } }, false)).toContain('Press play to hear this reply');
  });

  it('marks the speaker playing while the answer is read (plan #3043)', () => {
    const html = drawn({ key: 'a1', phase: 'playing', notes: {} });
    expect(html).toContain('data-speech-key="a1"');
    expect(html).toContain('data-playing="true"');
  });

  it('draws the switch pressed while speaking is on, and not while off', () => {
    const idle: SpeechState = { key: null, phase: 'idle', notes: {} };
    expect(drawn(idle, true)).toMatch(/aria-label="Read replies aloud"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Read replies aloud"/);
    expect(drawn(idle, false)).toMatch(/aria-label="Read replies aloud"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Read replies aloud"/);
  });
});

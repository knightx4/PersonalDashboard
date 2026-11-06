import { describe, expect, it } from 'vitest';
import {
  BATCH_MAX_MS,
  BUILDER_TEXTS,
  decideFirstText,
  enabledKinds,
  refList,
  SETTLE_MS,
  STALE_MS,
  storedTextWhen,
  textSwitches,
  writeDevBatch,
  type TextEvent,
} from './first-texts';

// 15:00 UTC is 10:00 in New York and 15:00 in London: outside quiet hours in both.
const NOW = new Date('2026-11-04T15:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function ev(id: string, fields: Partial<TextEvent> = {}): TextEvent {
  return { id, kind: 'shipped', createdAt: ago(SETTLE_MS + 60_000), ref: `#2854.${id}`, title: `Step ${id}`, detail: null, ...fields };
}

const decide = (events: TextEvent[], extra: Partial<Parameters<typeof decideFirstText>[0]> = {}) =>
  decideFirstText({ rule: BUILDER_TEXTS, enabled: BUILDER_TEXTS.defaults, events, now: NOW, timeZone: 'UTC', sentToday: 0, ...extra });

describe('decideFirstText', () => {
  it('sends nothing when nothing happened', () => {
    expect(decide([])).toEqual({ send: false, reason: 'nothing', close: [] });
  });

  it('waits while events are still arriving, so a burst becomes one text', () => {
    const d = decide([ev('1', { createdAt: ago(60_000) }), ev('2', { createdAt: ago(SETTLE_MS + 1) })]);
    expect(d).toMatchObject({ send: false, reason: 'settling' });
  });

  it('sends a stream that never pauses once its oldest event is old enough', () => {
    const d = decide([ev('1', { createdAt: ago(BATCH_MAX_MS) }), ev('2', { createdAt: ago(10_000) })]);
    expect(d.send).toBe(true);
  });

  it('batches every event into one text and covers them all', () => {
    const d = decide([ev('1'), ev('2'), ev('3', { kind: 'question', title: 'Which card?' })]);
    expect(d.send).toBe(true);
    if (!d.send) return;
    expect(d.texted.sort()).toEqual(['1', '2', '3']);
    expect(d.bubbles).toEqual(['#2854.3 is a question for you: Which card?', 'Shipped 2: #2854.1 (Step 1) and #2854.2 (Step 2).']);
  });

  // Note 6a69a1c3: a text first is unprompted, so every one reaches the phone.
  it('pushes every text, a shipped build as well as a step that needs the person', () => {
    const shipped = decide([ev('1')]);
    const needs = decide([ev('1'), ev('2', { kind: 'needs_you' })]);
    expect(shipped.send && shipped.push).toBe(true);
    expect(needs.send && needs.push).toBe(true);
  });

  it('holds everything in quiet hours', () => {
    // 03:00 in London.
    const d = decide([ev('1')], { now: new Date('2026-11-04T03:00:00Z'), timeZone: 'Europe/London' });
    expect(d).toMatchObject({ send: false, reason: 'quiet' });
  });

  it('keeps to the daily limit', () => {
    expect(decide([ev('1')], { sentToday: BUILDER_TEXTS.dailyLimit })).toMatchObject({ send: false, reason: 'limit' });
  });

  it('closes stale events and those switched off, unsent', () => {
    const d = decide([ev('old', { createdAt: ago(STALE_MS) }), ev('off', { kind: 'failed' }), ev('on')], { enabled: ['shipped'] });
    expect(d.close.sort()).toEqual(['off', 'old']);
    expect(d.send && d.texted).toEqual(['on']);
  });
});

describe('writeDevBatch', () => {
  it('names one event with its title', () => {
    expect(writeDevBatch([ev('1', { kind: 'needs_you', title: 'Set GITHUB_TOKEN in Vercel' })])).toEqual([
      '#2854.1 needs you: Set GITHUB_TOKEN in Vercel.',
    ]);
    expect(writeDevBatch([ev('1')])).toEqual(['Shipped #2854.1: Step 1.']);
    expect(writeDevBatch([ev('1', { kind: 'failed', detail: 'stalled' })])).toEqual(['The build of #2854.1 stalled.']);
  });

  it('puts what needs the person first, then what shipped, then what broke', () => {
    const out = writeDevBatch([
      ev('1', { kind: 'failed', detail: 'failed' }),
      ev('2'),
      ev('3', { kind: 'needs_you' }),
      ev('4', { kind: 'question' }),
    ]);
    expect(out).toEqual(['2 things need you: #2854.3 (Step 3) and #2854.4 (Step 4).', 'Shipped #2854.2: Step 2.', 'The build of #2854.1 failed.']);
  });

  it('counts the same happening once', () => {
    expect(writeDevBatch([ev('1', { kind: 'needs_you' }), ev('x', { kind: 'needs_you', ref: '#2854.1' })])).toEqual([
      '#2854.1 needs you: Step 1.',
    ]);
  });

  it('cuts a long title and lists many by outline', () => {
    const [one] = writeDevBatch([ev('1', { title: 'A'.repeat(200) })]);
    expect(one.length).toBeLessThan(110);
    expect(refList(['#1', '#2', '#3', '#4', '#5'])).toBe('#1, #2, #3 and 2 more');
  });

  it('names several by outline with a few whole words of each title', () => {
    expect(
      writeDevBatch([
        ev('1', { ref: '#2854.2', title: 'Give every person on People the same actions Ask Dash has' }),
        ev('2', { ref: '#2854.2.1', title: 'Show each change a person on People makes as a card with Undo or Confirm in their thread' }),
        ev('3', { ref: '#2854.4', title: 'Replies keep going when I leave the page' }),
      ]),
    ).toEqual([
      'Shipped 3: #2854.2 (Give every person on People the same…), #2854.2.1 (Show each change a person on People…) and #2854.4 (Replies keep going when I leave the page).',
    ]);
  });
});

describe('the switches on the form', () => {
  it('reads the rule defaults when nothing is stored', () => {
    expect(enabledKinds(BUILDER_TEXTS, null)).toEqual([...BUILDER_TEXTS.defaults]);
    expect(textSwitches(BUILDER_TEXTS, ['shipped']).map((s) => [s.kind, s.on])).toEqual([
      ['needs_you', false],
      ['question', false],
      ['shipped', true],
      ['failed', false],
    ]);
  });

  it('saves null for the defaults and the list otherwise, dropping unknown kinds', () => {
    expect(storedTextWhen(BUILDER_TEXTS, ['failed', 'shipped', 'question', 'needs_you'])).toBeNull();
    expect(storedTextWhen(BUILDER_TEXTS, ['shipped', 'nonsense'])).toEqual(['shipped']);
    expect(storedTextWhen(BUILDER_TEXTS, [])).toEqual([]);
  });
});

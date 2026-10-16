import { describe, expect, it, vi } from 'vitest';
import type { CaptureTokenCheck } from '@/lib/capture/tokens';
import type { AskDashResult } from '@/lib/dash/ask';
import { SPOKEN_MAX, VOICE_REQUEST_MAX_BYTES, answerVoiceAsk, spokenAnswer, type VoiceAskDeps } from './voice-ask';

/** The ask address: a Siri Shortcut asks Dash with an ask token and hears the answer. */

const OK: CaptureTokenCheck = { ok: true, userId: 'u1', tokenId: 't1' };

function answered(body: string): AskDashResult {
  return {
    conversation: { ref: 'c1', title: 'Jobs today' },
    turns: [
      { id: 'q', role: 'user', body: 'how many jobs did I apply to today', createdAt: '' },
      { id: 'a', role: 'assistant', body, createdAt: '' },
    ],
  };
}

function deps(over: Partial<VoiceAskDeps> = {}): VoiceAskDeps {
  return {
    check: vi.fn(async () => OK),
    ask: vi.fn(async () => answered('You applied to **3 jobs** today.')),
    ...over,
  };
}

const request = (body: unknown, token: string | null = 'dash_x') => ({
  token,
  contentLength: null,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('asking by voice', () => {
  it('asks Dash as the token owner and gives back the answer to speak and where it opens', async () => {
    const d = deps();
    const reply = await answerVoiceAsk(request({ question: '  how many jobs did I   apply to today ' }), d);
    expect(d.ask).toHaveBeenCalledWith('u1', 'how many jobs did I apply to today');
    expect(reply).toMatchObject({
      status: 200,
      body: { ok: true, spoken: 'You applied to 3 jobs today.', answer: 'You applied to **3 jobs** today.', href: '/ask/c1' },
    });
  });

  it('refuses a bad token before reading the question, with the reason to speak', async () => {
    const d = deps({
      check: vi.fn(async (): Promise<CaptureTokenCheck> => ({
        ok: false,
        status: 429,
        reason: 'limited',
        retryAfterSeconds: 30,
        message: 'Too many questions.',
      })),
    });
    const reply = await answerVoiceAsk(request('not json'), d);
    expect(reply).toMatchObject({ status: 429, headers: { 'Retry-After': '30' }, body: { ok: false, error: 'limited', spoken: 'Too many questions.' } });
    expect(d.ask).not.toHaveBeenCalled();
  });

  it('refuses a body that is too big without checking the token', async () => {
    const d = deps();
    const reply = await answerVoiceAsk({ token: 'dash_x', contentLength: String(VOICE_REQUEST_MAX_BYTES + 1), body: '{}' }, d);
    expect(reply.status).toBe(413);
    expect(d.check).not.toHaveBeenCalled();
  });

  it('says so when no question came', async () => {
    expect((await answerVoiceAsk(request({ text: 'hi' }), deps())).body).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await answerVoiceAsk(request({ question: '   ' }), deps())).body).toMatchObject({ ok: false, error: 'bad_request' });
  });

  it('speaks the reason when Dash did not answer', async () => {
    const d = deps({ ask: vi.fn(async (): Promise<AskDashResult> => ({ turns: [], error: 'Your question was not kept. Try again.' })) });
    expect((await answerVoiceAsk(request({ question: 'hi' }), d)).body).toEqual({
      ok: false,
      error: 'not_answered',
      spoken: 'Your question was not kept. Try again.',
    });
  });

  it('answers 503 when the database or the sign-in cannot be reached', async () => {
    const down = deps({ check: vi.fn(async () => { throw new Error('down'); }) });
    expect((await answerVoiceAsk(request({ question: 'hi' }), down)).status).toBe(503);
    const noSession = deps({ ask: vi.fn(async () => { throw new Error('no session'); }) });
    expect((await answerVoiceAsk(request({ question: 'hi' }), noSession)).status).toBe(503);
  });
});

describe('an answer read aloud', () => {
  it('takes out Markdown and turns list items into sentences', () => {
    const answer = '## Today\n\nYou applied to 2 roles:\n\n- [Analyst at Stripe](/jobs/roles/1)\n- *Designer* at `Figma`\n';
    expect(spokenAnswer(answer)).toBe('Today. You applied to 2 roles: Analyst at Stripe. Designer at Figma.');
  });

  it('cuts a long answer at a sentence and says where the rest is', () => {
    const answer = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const spoken = spokenAnswer(answer);
    expect(spoken.length).toBeLessThanOrEqual(SPOKEN_MAX);
    expect(spoken).toMatch(/is here\. The rest is in Ask on Dash\.$/);
  });
});

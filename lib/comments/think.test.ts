import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { readThought, thinkAboutComment, THINK_MODEL } from './think';

type Response = Pick<Anthropic.Message, 'content' | 'stop_reason'>;

function response(content: unknown[], stop: string = 'end_turn'): Response {
  return { content, stop_reason: stop } as unknown as Response;
}

const tool = (input: unknown) => ({ type: 'tool_use', id: 't1', name: 'reply', input });

describe('readThought', () => {
  it('reads an answer reported through the tool', () => {
    expect(readThought(response([tool({ answer: 'Yes, at about $2 a video.', needs_repo: false })]))).toEqual({
      kind: 'answer',
      body: 'Yes, at about $2 a video.',
    });
  });

  it('reads a hand-off to a session', () => {
    expect(readThought(response([tool({ needs_repo: true, why: 'Depends on the upload code.' })]))).toEqual({
      kind: 'needs_repo',
      why: 'Depends on the upload code.',
      instruction: false,
    });
  });

  it('reads prose written without the tool as the answer', () => {
    const reply = readThought(response([{ type: 'thinking', thinking: '' }, { type: 'text', text: 'It works.' }]));
    expect(reply).toEqual({ kind: 'answer', body: 'It works.' });
  });

  it('does not carry out an instruction', () => {
    expect(readThought(response([tool({ action: { name: 'file_idea', text: 'x' } })])).kind).toBe('error');
  });

  it('says so when it was cut off or declined', () => {
    expect(readThought(response([tool({ answer: 'Half' })], 'max_tokens')).kind).toBe('error');
    expect(readThought(response([], 'refusal')).kind).toBe('error');
    expect(readThought(response([])).kind).toBe('error');
  });
});

describe('thinkAboutComment', () => {
  it('asks the stronger model at high effort, without forcing the tool', async () => {
    const create = vi.fn().mockResolvedValue({
      model: THINK_MODEL,
      content: [tool({ answer: 'Feasible.', needs_repo: false })],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const spent: string[] = [];

    const reply = await thinkAboutComment(
      { apiKey: 'k', client, onSpend: (report) => spent.push(report.model) },
      'the row',
    );

    expect(reply).toEqual({ kind: 'answer', body: 'Feasible.' });
    const [body] = create.mock.calls[0];
    expect(body.model).toBe(THINK_MODEL);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.output_config).toEqual({ effort: 'high' });
    expect(spent).toEqual([THINK_MODEL]);
  });

  it('turns a thrown error into a sentence', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } } as unknown as Anthropic;
    expect(await thinkAboutComment({ apiKey: 'k', client }, 'row')).toEqual({ kind: 'error', error: 'boom' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { recordSpend, recordSpendFromResponse } from './record';
import { EMPTY_USAGE } from './pricing';

/**
 * The ledger, and the promise that it never costs you anything.
 *
 * The rule worth a test rather than a comment: a bookkeeping write that fails
 * must not take the work it was measuring down with it. Somebody who just
 * imported a reading list should not lose it because an insert timed out, and
 * the only way to be sure of that is to make the failure happen.
 */

function clientRecording() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const client = { from: vi.fn().mockReturnValue({ insert }) };
  return { client: client as never, insert, from: client.from };
}

function clientThatFails(mode: 'error' | 'throws') {
  const insert = vi.fn(() =>
    mode === 'throws'
      ? Promise.reject(new Error('connection lost'))
      : Promise.resolve({ error: { message: 'permission denied' } }),
  );
  return { client: { from: () => ({ insert }) } as never, insert };
}

const CALL = {
  module: 'learn' as const,
  operation: 'plan-topic',
  model: 'claude-opus-5',
  usage: { ...EMPTY_USAGE, inputTokens: 1000, outputTokens: 500 },
};

describe('recording a call', () => {
  it('writes one row, with the tokens and the computed cost', async () => {
    const { client, insert, from } = clientRecording();

    expect(await recordSpend(client, 'user-1', CALL)).toBe(true);
    expect(from).toHaveBeenCalledWith('model_spend');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        module: 'learn',
        operation: 'plan-topic',
        model: 'claude-opus-5',
        input_tokens: 1000,
        output_tokens: 500,
        // 1000×$5/MTok + 500×$25/MTok, in micro-dollars.
        cost_micros: 17_500,
      }),
    );
  });

  it('records the tokens with no cost when the model has no rate', async () => {
    const { client, insert } = clientRecording();

    await recordSpend(client, 'user-1', { ...CALL, model: 'claude-not-yet-released' });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ cost_micros: null, input_tokens: 1000 }),
    );
  });

  it('carries the user id from the caller, since the policy compares it', async () => {
    const { client, insert } = clientRecording();
    await recordSpend(client, 'user-2', CALL);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-2' }));
  });
});

describe('when the ledger write fails', () => {
  it('swallows a rejected insert rather than losing the work it measured', async () => {
    const { client } = clientThatFails('error');
    await expect(recordSpend(client, 'user-1', CALL)).resolves.toBe(false);
  });

  it('swallows a thrown one too', async () => {
    const { client } = clientThatFails('throws');
    await expect(recordSpend(client, 'user-1', CALL)).resolves.toBe(false);
  });
});

describe('recording straight off a response', () => {
  it('reads the four counts out of the usage object', async () => {
    const { client, insert } = clientRecording();

    await recordSpendFromResponse(client, 'user-1', {
      module: 'learn',
      operation: 'suggest-sources',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 200,
        output_tokens: 100,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 50,
      },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_tokens: 200,
        cached_input_tokens: 4000,
        cache_write_tokens: 50,
        output_tokens: 100,
      }),
    );
  });

  it('records a call whose response carried no usage at all', async () => {
    const { client, insert } = clientRecording();

    await recordSpendFromResponse(client, 'user-1', {
      module: 'learn',
      operation: 'parse-references',
      model: 'claude-haiku-4-5',
      usage: undefined,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ input_tokens: 0, output_tokens: 0, cost_micros: 0 }),
    );
  });
});

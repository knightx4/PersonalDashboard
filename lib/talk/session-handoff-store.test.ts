import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionHandoff } from './handoffs';

const fire = vi.fn();
vi.mock('./handoff-fire', () => ({ fireSessionHandoff: (...args: unknown[]) => fire(...args) }));

const { sessionHandoffPorts } = await import('./session-handoff-store');

const HANDOFF = { id: 'h1', state: 'queued' } as SessionHandoff;
const ASKER = {
  thread: { kind: 'chat' as const, chatId: 'c1', advisorId: 'b1' },
  messageId: 'm1',
  asked: 'write it up',
  botName: 'Gert',
  href: '/you/people/b1',
};

describe('sessionHandoffPorts (plan #3005)', () => {
  beforeEach(() => fire.mockReset());

  it("starts People's hand-off through fireSessionHandoff, the one launch path", async () => {
    fire.mockResolvedValue({ state: 'running', runId: 'run_1', error: null });
    const core = {} as never;
    const result = await sessionHandoffPorts(core, 'u1').launch!(HANDOFF, ASKER);
    expect(result).toEqual({ ok: true });
    expect(fire).toHaveBeenCalledWith(core, 'u1', HANDOFF);
  });

  it('says why when the session would not start', async () => {
    fire.mockResolvedValue({ state: 'failed', runId: null, error: 'The session could not be started: 401' });
    const result = await sessionHandoffPorts({} as never, 'u1').launch!(HANDOFF, ASKER);
    expect(result).toEqual({ ok: false, error: 'The session could not be started: 401' });
  });
});

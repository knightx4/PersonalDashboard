import { describe, expect, it, vi } from 'vitest';
import type { FireRoutineResult } from '@/lib/feedback/routine';
import {
  botPageBrief,
  MAKE_PAGE,
  MAKE_PAGE_TOOL_NAME,
  MAX_PAGE_CONTEXT,
  PAGE_ALREADY,
  PAGE_STARTED,
  pageFailedText,
  pageRequest,
  startBotPage,
  type BotPagePorts,
  type PageAsker,
} from './bot-pages';

const asker: PageAsker = {
  advisorId: 'a-gert',
  advisorName: 'Gert',
  chatId: 'c-1',
  messageId: 'm-1',
  asked: 'prepare me something for my interview tomorrow to practise my accounting',
  persona: 'You are Gert, the career manager.',
  href: '/chat/people/gert',
};

const input = {
  request: 'An accounting practice drill: journal entries, revenue recognition, accruals, month-end close, with reveal-the-answer and a score.',
  title: '  Accounting   practice drill ',
  context: 'Second round at Acme, Thursday 10:00, FP&A Manager.',
};

const fired: FireRoutineResult = { ok: true, detail: 'running', status: 200, body: {}, runId: 'cse_1' };
const refused: FireRoutineResult = { ok: false, error: 'Anthropic answered 401.', status: 401, body: null };

function ports(over: Partial<BotPagePorts> = {}): BotPagePorts & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { keep: [], fire: [], mark: [], count: [] };
  return {
    calls,
    keep: vi.fn(async (a, p) => {
      calls.keep.push([a, p]);
      return { id: 'h-1' };
    }),
    fire: vi.fn(async (brief) => {
      calls.fire.push(brief);
      return fired;
    }),
    mark: vi.fn(async (id, result) => {
      calls.mark.push([id, result]);
    }),
    count: vi.fn(async (id) => {
      calls.count.push(id);
    }),
    ...over,
  };
}

describe('make_page', () => {
  it('is a hand-off the Dash loop sends to its handOff hook', () => {
    expect(MAKE_PAGE).toMatchObject({ name: MAKE_PAGE_TOOL_NAME, kind: 'handoff' });
    expect(MAKE_PAGE.definition.input_schema.required).toEqual(['request', 'title']);
  });

  it('reads the request, tidies the title and cuts a long context', () => {
    const parsed = pageRequest({ ...input, context: 'x'.repeat(MAX_PAGE_CONTEXT + 50) });
    expect(parsed).toMatchObject({ ok: true, title: 'Accounting practice drill' });
    expect(parsed.ok && parsed.context?.length).toBe(MAX_PAGE_CONTEXT);
    expect(pageRequest({ ...input, context: '  ' })).toMatchObject({ ok: true, context: null });
  });

  it('refuses a call with no request or no title', () => {
    expect(pageRequest({ title: 'x' })).toEqual({ ok: false, error: 'request is missing. Say what to make.' });
    expect(pageRequest({ request: 'x' })).toMatchObject({ ok: false });
    expect(pageRequest(null)).toMatchObject({ ok: false });
  });

  it('starts the routine on the bot-pages skill, naming the row, the account and the chat', () => {
    const brief = botPageBrief({ id: 'h-1', title: 'Drill', request: 'Make a drill.' }, asker, 'u-1');
    expect(brief.split('\n')[0]).toBe('Follow .claude/skills/bot-pages/SKILL.md.');
    expect(brief).toContain('Bot page h-1');
    expect(brief).toContain('user_id u-1');
    expect(brief).toContain('chat c-1');
    expect(brief).toContain('bot Gert');
  });
});

describe('starting a page', () => {
  it('keeps it, fires the routine, marks it fired, counts the run and tells the bot to say it is on it', async () => {
    const p = ports();
    const result = await startBotPage(p, asker, input, 'u-1');
    expect(result).toEqual({ ok: true, rows: [], note: PAGE_STARTED });
    expect(p.calls.keep[0]).toEqual([asker, { request: input.request, title: 'Accounting practice drill', context: input.context }]);
    expect(String(p.calls.fire[0])).toContain('Bot page h-1');
    expect(p.calls.mark).toEqual([['h-1', fired]]);
    expect(p.calls.count).toEqual(['h-1']);
  });

  it('starts nothing for a message that already has a page', async () => {
    const p = ports({ keep: vi.fn(async () => null) });
    expect(await startBotPage(p, asker, input, 'u-1')).toEqual({ ok: true, rows: [], note: PAGE_ALREADY });
    expect(p.fire).not.toHaveBeenCalled();
  });

  it('marks a page whose routine would not start as failed, counts nothing, and has the bot say it did not work', async () => {
    const p = ports({ fire: vi.fn(async () => refused) });
    const result = await startBotPage(p, asker, input, 'u-1');
    expect(result.ok && result.note).toMatch(/could not be started/);
    expect(p.calls.mark).toEqual([['h-1', refused]]);
    expect(p.count).not.toHaveBeenCalled();
  });

  it('treats a fire that throws as one that failed', async () => {
    const p = ports({
      fire: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const result = await startBotPage(p, asker, input, 'u-1');
    expect(result.ok && result.note).toMatch(/could not be started/);
    expect((p.calls.mark[0] as [string, FireRoutineResult])[1]).toMatchObject({ ok: false, error: 'network down' });
  });

  it('never throws when the request cannot be kept', async () => {
    const p = ports({
      keep: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const result = await startBotPage(p, asker, input, 'u-1');
    expect(result.ok && result.note).toMatch(/could not be saved/);
    expect(p.fire).not.toHaveBeenCalled();
  });

  it('passes a bad call back to the model as an error', async () => {
    const p = ports();
    expect(await startBotPage(p, asker, { title: 'x' }, 'u-1')).toMatchObject({ ok: false });
    expect(p.keep).not.toHaveBeenCalled();
  });
});

describe('a failed page', () => {
  it('reads as the bot saying it did not work, with why', () => {
    expect(pageFailedText('The session stopped')).toBe("That didn't work, sorry. The session stopped. Ask me again and I'll have another go.");
    expect(pageFailedText(null)).toBe("That didn't work, sorry. Ask me again and I'll have another go.");
  });
});

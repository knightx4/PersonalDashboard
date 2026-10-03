import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { MailSearchHit, MailSearchInput, MailSearchResult } from '@/lib/inbox/search-mail';
import type { MailReadInput, MailReadResult } from '@/lib/inbox/read-mail';
import { askDash, type AskStores } from '@/lib/dash/ask';
import type { NewTalkTurn } from '@/lib/talk/talk';
import { isOpenableHref, toolResultText, type AskContext, type AskDb } from './db';
import { parseMailRef, senderName } from './mail';
import { executeAskTool } from './tools';

/**
 * search_mail (plan #1316) with the Gmail search stubbed: the person's days
 * become instants in their timezone, the rows link to Gmail, and the saved
 * conversation keeps none of a message's subject or preview.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const SUBJECT = 'Re: the flat on Elm Street';
const PREVIEW = 'Happy to renew the lease for another year at the same rent';

const HIT: MailSearchHit = {
  accountId: 'acc-1',
  mailbox: 'me@example.com',
  messageId: '18f2a',
  threadId: '18f2a',
  from: 'Anthony Rees <anthony@example.com>',
  to: 'me@example.com',
  subject: SUBJECT,
  date: '2026-09-28T13:05:00.000Z',
  snippet: PREVIEW,
  gmailUrl: 'https://mail.google.com/mail/?authuser=me%40example.com#all/18f2a',
};

function context(
  result: MailSearchResult,
  extra: Partial<AskContext> = {},
): { ctx: AskContext; searches: MailSearchInput[] } {
  const searches: MailSearchInput[] = [];
  const ctx: AskContext = {
    userId: ME,
    today: '2026-10-01',
    timezone: 'Europe/London',
    // Mail is searched whichever workspaces are on.
    enabledModules: [],
    db: (async () => {
      throw new Error('search_mail reads no table');
    }) as AskDb,
    searchSources: [],
    searchMail: async (input) => {
      searches.push(input);
      return result;
    },
    ...extra,
  };
  return { ctx, searches };
}

const FOUND: MailSearchResult = {
  ok: true,
  query: 'from:Anthony',
  messages: [HIT],
  searched: ['me@example.com'],
  problems: [],
  more: false,
};

describe('search_mail', () => {
  it('searches as the person, turning their days into instants in their timezone', async () => {
    const { ctx, searches } = context(FOUND);
    const result = await executeAskTool(
      'search_mail',
      { from: 'Anthony', words: ' lease ', after: '2026-09-28', before: '2026-10-01' },
      ctx,
    );
    expect(result.ok).toBe(true);
    // London is an hour ahead of UTC in September.
    expect(searches).toEqual([
      { from: 'Anthony', words: 'lease', after: '2026-09-27T23:00:00.000Z', before: '2026-09-30T23:00:00.000Z' },
    ]);
  });

  it('gives the model the subject and preview, and cites the message by sender and day with its Gmail link', async () => {
    const { ctx } = context(FOUND);
    const result = await executeAskTool('search_mail', { from: 'Anthony' }, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([
      {
        table: 'gmail',
        ref: 'acc-1:18f2a',
        // ICU writes September "Sep" or "Sept" depending on its version.
        title: expect.stringMatching(/^Email from Anthony Rees, 28 Sept? 2026$/),
        href: HIT.gmailUrl,
        detail: expect.objectContaining({ subject: SUBJECT, preview: PREVIEW, received: '2026-09-28 14:05' }),
      },
    ]);
    const sent = toolResultText(result);
    expect(sent).toContain(SUBJECT);
    expect(sent).not.toContain('"kept"');
  });

  it('names the mailbox only when more than one was searched, and passes on a mailbox it could not search', async () => {
    const { ctx } = context({
      ...FOUND,
      more: true,
      problems: [
        { accountId: 'acc-2', mailbox: 'work@example.com', kind: 'needs_reauth', reason: 'Reconnect work@example.com in Settings.' },
      ],
    });
    const result = await executeAskTool('search_mail', {}, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0].detail).toMatchObject({ mailbox: 'me@example.com' });
    expect(result.note).toContain('Reconnect work@example.com in Settings.');
    expect(result.note).toContain('More messages matched');
  });

  it('points at Settings when no mailbox is connected, and refuses where mail cannot be searched', async () => {
    const none = context({ ok: false, kind: 'no_mailbox', reason: 'none' }).ctx;
    expect(await executeAskTool('search_mail', { from: 'Anthony' }, none)).toEqual({
      ok: false,
      error: expect.stringContaining('connect one in Settings'),
    });
    const connector = context(FOUND, { searchMail: undefined }).ctx;
    expect((await executeAskTool('search_mail', {}, connector)).ok).toBe(false);
  });

  it('refuses a malformed day, and an end before the start', async () => {
    const { ctx } = context(FOUND);
    expect(await executeAskTool('search_mail', { after: 'Monday' }, ctx)).toEqual({
      ok: false,
      error: 'after must be a date written YYYY-MM-DD.',
    });
    expect((await executeAskTool('search_mail', { after: '2026-09-28', before: '2026-09-28' }, ctx)).ok).toBe(false);
  });

  it('drops a row that links anywhere but the app or Gmail', async () => {
    const { ctx } = context({
      ...FOUND,
      messages: [HIT, { ...HIT, messageId: 'x', gmailUrl: 'https://evil.example.com/#all/x' }],
    });
    const result = await executeAskTool('search_mail', {}, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows.map((row) => row.ref)).toEqual(['acc-1:18f2a']);
  });
});

describe('isOpenableHref', () => {
  it('takes a path in the app or a message in Gmail, and nothing else', () => {
    expect(isOpenableHref('/todo?task=1')).toBe(true);
    expect(isOpenableHref(HIT.gmailUrl)).toBe(true);
    expect(isOpenableHref('//evil.example.com/x')).toBe(false);
    expect(isOpenableHref('http://mail.google.com/mail/#all/1')).toBe(false);
    expect(isOpenableHref('https://mail.google.com.evil.example/#all/1')).toBe(false);
    expect(isOpenableHref('https://user@mail.google.com/#all/1')).toBe(false);
    expect(isOpenableHref('javascript:alert(1)')).toBe(false);
  });
});

describe('senderName', () => {
  it('reads the display name, or the address when there is none', () => {
    expect(senderName('Anthony Rees <anthony@example.com>')).toBe('Anthony Rees');
    expect(senderName('"Rees, Anthony" <anthony@example.com>')).toBe('Rees, Anthony');
    expect(senderName('<anthony@example.com>')).toBe('anthony@example.com');
    expect(senderName('anthony@example.com')).toBe('anthony@example.com');
    expect(senderName(null)).toBe('an unknown sender');
  });
});

describe('a question about email, kept', () => {
  it('saves the answer and the link, and none of the subject or preview the model read', async () => {
    const replies = [
      { content: [{ type: 'tool_use', id: 'u1', name: 'search_mail', input: { from: 'Anthony' } }], stop_reason: 'tool_use' },
      {
        content: [
          {
            type: 'tool_use',
            id: 'u2',
            name: 'answer',
            input: {
              answer: 'Anthony Rees last emailed you on 28 September, about the flat.',
              cited: [{ table: 'gmail', ref: 'acc-1:18f2a' }],
            },
          },
        ],
        stop_reason: 'tool_use',
      },
    ].map((r) => ({ ...r, usage: { input_tokens: 10, output_tokens: 10 } }));
    const sentToModel: string[] = [];
    let call = 0;
    const client = {
      messages: {
        create: async (params: { messages: unknown }) => {
          sentToModel.push(JSON.stringify(params.messages));
          return replies[call++];
        },
      },
    } as unknown as Anthropic;

    const written: NewTalkTurn[] = [];
    const stores: AskStores = {
      start: async () => ({ kind: 'ask', ref: 'conv', title: 'q' }),
      load: async () => [],
      append: async (_subject, turns) => {
        written.push(...turns);
        return turns.map((t, i) => ({ id: `t${written.length + i}`, role: t.role, body: t.body, createdAt: '2026-10-01T10:00:00Z' }));
      },
      recordSpend: async () => {},
      saveProposal: async () => {
        throw new Error('no proposals');
      },
      attachProposals: async () => {},
      discardProposals: async () => {},
    };

    const { ctx } = context(FOUND);
    const result = await askDash(
      {
        question: 'When did Anthony last email me?',
        today: ctx.today,
        execute: (name, input) => executeAskTool(name, input, ctx),
        anthropicApiKey: 'k',
        client,
      },
      stores,
    );
    expect(result.error).toBeUndefined();

    // The model read the subject and preview for this answer.
    expect(sentToModel[1]).toContain(SUBJECT);
    expect(sentToModel[1]).toContain(PREVIEW);

    // What is kept: the answer, a citation by sender, day and link, and a count.
    const answer = written.find((t) => t.role === 'assistant')!;
    expect(answer.citations).toEqual([
      { table: 'gmail', ref: 'acc-1:18f2a', title: expect.stringMatching(/^Email from Anthony Rees, 28 Sept? 2026$/), href: HIT.gmailUrl },
    ]);
    expect(answer.toolCalls).toEqual([{ name: 'search_mail', input: { from: 'Anthony' }, result: { ok: true, matched: 1 } }]);
    const saved = JSON.stringify(written);
    expect(saved).not.toContain(SUBJECT);
    expect(saved).not.toContain('Elm Street');
    expect(saved).not.toContain(PREVIEW);
  });
});

// ---------------------------------------------------------------------------
// read_mail (plan #1317)
// ---------------------------------------------------------------------------

const BODY =
  'Hi, thanks for your time on Tuesday. We would like you to start on Monday 2 November, ' +
  'with the first week spent at the Leeds office. Your onboarding pack follows separately.';

const READ: MailReadResult = {
  ok: true,
  message: {
    accountId: 'acc-1',
    mailbox: 'me@example.com',
    messageId: '18f2a',
    from: 'Priya Shah <priya@recruit.example>',
    to: 'me@example.com',
    subject: 'Your offer: next steps',
    date: '2026-09-28T13:05:00.000Z',
    text: BODY,
    truncated: false,
    gmailUrl: 'https://mail.google.com/mail/?authuser=me%40example.com#all/18f2a',
  },
};

function readContext(result: MailReadResult, extra: Partial<AskContext> = {}) {
  const reads: MailReadInput[] = [];
  const { ctx } = context(
    {
      ok: true,
      query: 'from:Priya',
      messages: [{ ...HIT, from: 'Priya Shah <priya@recruit.example>', subject: 'Your offer: next steps' }],
      searched: ['me@example.com'],
      problems: [],
      more: false,
    },
    {
      readMail: async (input) => {
        reads.push(input);
        return result;
      },
      ...extra,
    },
  );
  return { ctx, reads };
}

describe('read_mail', () => {
  it('opens the message named by the ref search_mail returned, and gives the model its text', async () => {
    const { ctx, reads } = readContext(READ);
    const result = await executeAskTool('read_mail', { ref: 'acc-1:18f2a' }, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(reads).toEqual([{ accountId: 'acc-1', messageId: '18f2a' }]);
    expect(result.rows).toEqual([
      {
        table: 'gmail',
        ref: 'acc-1:18f2a',
        title: expect.stringMatching(/^Email from Priya Shah, 28 Sept? 2026$/),
        href: READ.ok ? READ.message.gmailUrl : '',
        detail: expect.objectContaining({ subject: 'Your offer: next steps', text: BODY, received: '2026-09-28 14:05' }),
      },
    ]);
    expect(result.kept).toEqual({ opened: 1 });
    const sent = toolResultText(result);
    expect(sent).toContain('Monday 2 November');
    expect(sent).not.toContain('"kept"');
  });

  it('says when the text was cut, and when there is none', async () => {
    if (!READ.ok) throw new Error('fixture');
    const cut = readContext({ ok: true, message: { ...READ.message, truncated: true } }).ctx;
    const long = await executeAskTool('read_mail', { ref: 'acc-1:18f2a' }, cut);
    expect(long.ok && long.note).toContain('was cut');
    const empty = readContext({ ok: true, message: { ...READ.message, text: '' } }).ctx;
    const none = await executeAskTool('read_mail', { ref: 'acc-1:18f2a' }, empty);
    expect(none.ok && none.note).toContain('no text');
  });

  it('refuses a ref that is not a message, and passes on why a message could not be read', async () => {
    const { ctx, reads } = readContext(READ);
    expect((await executeAskTool('read_mail', { ref: 'vault_notes/42' }, ctx)).ok).toBe(false);
    expect((await executeAskTool('read_mail', {}, ctx)).ok).toBe(false);
    expect(reads).toEqual([]);

    const gone = readContext({ ok: false, kind: 'not_found', reason: 'No message with that id is in me@example.com.' }).ctx;
    expect(await executeAskTool('read_mail', { ref: 'acc-1:ffff' }, gone)).toEqual({
      ok: false,
      error: expect.stringContaining('Find the message with search_mail'),
    });
    const revoked = readContext({ ok: false, kind: 'needs_reauth', reason: 'Reconnect me@example.com in Settings.' }).ctx;
    expect(await executeAskTool('read_mail', { ref: 'acc-1:18f2a' }, revoked)).toEqual({
      ok: false,
      error: 'Reconnect me@example.com in Settings.',
    });
    const connector = readContext(READ, { readMail: undefined }).ctx;
    expect((await executeAskTool('read_mail', { ref: 'acc-1:18f2a' }, connector)).ok).toBe(false);
  });

  it('splits a ref into the mailbox and the message', () => {
    expect(parseMailRef('6a1f0c2e-1111-4000-8000-000000000001:18f2a9b')).toEqual({
      accountId: '6a1f0c2e-1111-4000-8000-000000000001',
      messageId: '18f2a9b',
    });
    expect(parseMailRef('acc-1')).toBeNull();
    expect(parseMailRef('acc-1:18f2a:x')).toBeNull();
  });
});

describe('a question about what an email said, kept', () => {
  it('saves the answer and the link, and none of the text the model read', async () => {
    const ANSWER = 'Priya says you start on Monday 2 November.';
    const replies = [
      { content: [{ type: 'tool_use', id: 'u1', name: 'search_mail', input: { from: 'Priya' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'u2', name: 'read_mail', input: { ref: 'acc-1:18f2a' } }], stop_reason: 'tool_use' },
      {
        content: [
          { type: 'tool_use', id: 'u3', name: 'answer', input: { answer: ANSWER, cited: [{ table: 'gmail', ref: 'acc-1:18f2a' }] } },
        ],
        stop_reason: 'tool_use',
      },
    ].map((r) => ({ ...r, usage: { input_tokens: 10, output_tokens: 10 } }));
    const sentToModel: string[] = [];
    let call = 0;
    const client = {
      messages: {
        create: async (params: { messages: unknown }) => {
          sentToModel.push(JSON.stringify(params.messages));
          return replies[call++];
        },
      },
    } as unknown as Anthropic;

    const written: NewTalkTurn[] = [];
    const stores: AskStores = {
      start: async () => ({ kind: 'ask', ref: 'conv', title: 'q' }),
      load: async () => [],
      append: async (_subject, turns) => {
        written.push(...turns);
        return turns.map((t, i) => ({ id: `t${written.length + i}`, role: t.role, body: t.body, createdAt: '2026-10-01T10:00:00Z' }));
      },
      recordSpend: async () => {},
      saveProposal: async () => {
        throw new Error('no proposals');
      },
      attachProposals: async () => {},
      discardProposals: async () => {},
    };

    const { ctx } = readContext(READ);
    const result = await askDash(
      {
        question: 'What did the recruiter say about the start date?',
        today: ctx.today,
        execute: (name, input) => executeAskTool(name, input, ctx),
        anthropicApiKey: 'k',
        client,
      },
      stores,
    );
    expect(result.error).toBeUndefined();

    // The model read the message's text for this answer.
    expect(sentToModel[2]).toContain('first week spent at the Leeds office');

    // What is kept: the answer, a citation by sender, day and link, and counts.
    const answer = written.find((t) => t.role === 'assistant')!;
    expect(answer.body).toBe(ANSWER);
    expect(answer.citations).toEqual([
      {
        table: 'gmail',
        ref: 'acc-1:18f2a',
        title: expect.stringMatching(/^Email from Priya Shah, 28 Sept? 2026$/),
        href: READ.ok ? READ.message.gmailUrl : '',
      },
    ]);
    expect(answer.toolCalls).toEqual([
      { name: 'search_mail', input: { from: 'Priya' }, result: { ok: true, matched: 1 } },
      { name: 'read_mail', input: { ref: 'acc-1:18f2a' }, result: { ok: true, opened: 1 } },
    ]);
    const saved = JSON.stringify(written);
    expect(saved).not.toContain('Leeds');
    expect(saved).not.toContain('thanks for your time');
    expect(saved).not.toContain('onboarding pack');
    expect(saved).not.toContain('Your offer');
  });
});

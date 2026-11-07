import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { askDash, type AskStores } from '@/lib/dash/ask';
import type { DashSlip } from '@/lib/dash/slips';
import type { NewTalkTurn, TalkTurn } from './talk';
import { attachmentClaim, claimSlip, falseAttachment, NOTHING_ATTACHED_ASK } from './attachment-claim';

describe('attachmentClaim (plan #3050.1)', () => {
  it("catches Newt's reply of 7 November", () => {
    const reply = "Markets had a choppy week.\n\nHere's your chart, attached as stocks_week_nov6_2026.png!";
    expect(attachmentClaim(reply)).toBe("Here's your chart, attached as stocks_week_nov6_2026.png!");
  });

  it.each([
    "I've attached the PDF.",
    'See attached for the breakdown.',
    'Attaching the spreadsheet now.',
    'Here is the chart of the S&P over the week.',
    'The chart below shows the Dow and the Nasdaq.',
    'Sent you markets.csv just now.',
  ])('counts "%s" as a claim', (text) => {
    expect(attachmentClaim(text)).not.toBeNull();
  });

  it.each([
    'Thanks for the PDF you sent, I read it.',
    "You've attached two pictures; the second is blurry.",
    'The note attached to the role says they want Go.',
    'Here is the chart on their site: https://example.com/markets',
    'The S&P closed up 1.2% on the week and the Nasdaq up 2%.',
    "I can't send a chart here yet, but the S&P rose 1.2%.",
  ])('does not count "%s"', (text) => {
    expect(attachmentClaim(text)).toBeNull();
  });
});

describe('falseAttachment', () => {
  it('lets a chart claim through when a chart was drawn', () => {
    expect(falseAttachment('Here is the chart.', 1)).toBeNull();
    expect(falseAttachment('The chart below shows the Dow.', 1)).toBeNull();
    expect(falseAttachment('Here is the chart.', 0)).toBe('Here is the chart.');
  });

  it('still catches a file claimed beside a drawn chart (plan #3050.2.2)', () => {
    expect(falseAttachment("Here's your chart, attached as stocks_week.png!", 1)).toBe("Here's your chart, attached as stocks_week.png!");
    expect(falseAttachment("I've attached the PDF.", 1)).toBe("I've attached the PDF.");
    expect(falseAttachment('Here is the spreadsheet.', 2)).toBe('Here is the spreadsheet.');
    expect(falseAttachment('Thanks for the PDF you sent.', 1)).toBeNull();
  });

  it('lets any claim through when the code made a file (plan #3050.3.1)', () => {
    expect(falseAttachment("Here's your chart, attached as markets.png!", 0, 1)).toBeNull();
    expect(falseAttachment("I've attached the PDF.", 1, 2)).toBeNull();
    expect(falseAttachment("I've attached the PDF.", 0, 0)).toBe("I've attached the PDF.");
  });
});

describe('claimSlip', () => {
  it('names who claimed and what they said, cut to fit', () => {
    expect(claimSlip('Newt', 'Attached!')).toEqual({ kind: 'claimed_attachment', what: 'Newt said a file was attached when none was sent: "Attached!"' });
    expect(claimSlip('Newt', 'x'.repeat(500)).what.length).toBeLessThan(300);
  });
});

describe('Ask Dash (plan #3050.1)', () => {
  const reply = (answer: string) => ({
    content: [{ type: 'tool_use', id: 'a', name: 'answer', input: { answer, cited: [] } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  function harness(answer: string) {
    const slips: DashSlip[] = [];
    const kept: NewTalkTurn[] = [];
    let n = 0;
    const stores: AskStores = {
      start: async (question) => ({ kind: 'ask', ref: 'conv-new', title: question }),
      load: async () => [],
      append: async (_subject, turns: readonly NewTalkTurn[]) => {
        kept.push(...turns);
        return turns.map((t): TalkTurn => ({ id: `t${++n}`, role: t.role, body: t.body, createdAt: '2026-11-07T10:00:00Z' }));
      },
      recordSpend: async () => {},
      saveProposal: async () => {
        throw new Error('no proposals here');
      },
      attachProposals: async () => {},
      discardProposals: async () => {},
      recordSlip: async (slip) => void slips.push(slip),
    };
    const client = { messages: { create: async () => reply(answer) } } as unknown as Anthropic;
    const execute = async () => ({ ok: true as const, rows: [] });
    return { stores, client, execute, slips, kept };
  }

  it('ends an answer that claims a file with a sentence saying nothing is attached, and keeps a slip', async () => {
    const h = harness('I have attached the PDF.');
    await askDash({ question: 'Send me a PDF', today: '2026-11-07', execute: h.execute, anthropicApiKey: 'k', client: h.client }, h.stores);
    expect(h.kept.at(-1)?.body).toBe(`I have attached the PDF.\n\n${NOTHING_ATTACHED_ASK}`);
    expect(h.slips).toEqual([expect.objectContaining({ kind: 'claimed_attachment', surface: 'ask', conversation: 'ask:conv-new' })]);
  });

  it('keeps an honest answer as it was', async () => {
    const h = harness('The S&P rose 1.2%.');
    await askDash({ question: 'Markets?', today: '2026-11-07', execute: h.execute, anthropicApiKey: 'k', client: h.client }, h.stores);
    expect(h.kept.at(-1)?.body).toBe('The S&P rose 1.2%.');
    expect(h.slips).toEqual([]);
  });
});

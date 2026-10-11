import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { askDash, type AskStores } from './ask';
import { filesEstimate, fileTokens } from './file-cost';
import { fileBlocks, IMAGE_MAX_BYTES, pdfPageCount, readFile, SEND_MAX_BYTES, withinRequest, type DashFile } from './files';
import { withNewestFiles } from './loop';
import { ASK_MODEL } from './ask';
import type { NewTalkTurn, TalkTurn } from '@/lib/talk/talk';

/** Plan #1716: Dash reads the pictures and PDFs sent with the newest question. */

const bytes = (text: string) => new TextEncoder().encode(text);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('readFile', () => {
  it('sends a picture and a PDF as they are, and text files as text', () => {
    expect(readFile('bill.png', 'image/png', bytes('png'))).toEqual({
      name: 'bill.png',
      kind: 'image',
      mediaType: 'image/png',
      data: Buffer.from('png').toString('base64'),
    });
    expect(readFile('bill.pdf', 'application/pdf', bytes('%PDF /Type /Page'))).toMatchObject({ kind: 'pdf' });
    expect(readFile('rows.csv', 'text/csv', bytes('a,b\n1,2'))).toEqual({ name: 'rows.csv', kind: 'text', text: 'a,b\n1,2' });
  });

  it('names what it cannot read, with the reason', () => {
    expect(readFile('old.doc', 'application/msword', bytes('x'))).toMatchObject({ kind: 'unread', why: expect.stringMatching(/\.doc/) });
    expect(readFile('broken.docx', DOCX, bytes('not a zip'))).toMatchObject({ kind: 'unread' });
    expect(readFile('huge.jpg', 'image/jpeg', new Uint8Array(IMAGE_MAX_BYTES + 1))).toMatchObject({ kind: 'unread' });
    const long = bytes(Array.from({ length: 101 }, () => '<< /Type /Page >>').join('\n') + ' /Type /Pages');
    expect(readFile('book.pdf', 'application/pdf', long)).toMatchObject({ kind: 'unread', why: expect.stringMatching(/101 pages/) });
  });

  it('counts page objects, not the page tree', () => {
    expect(pdfPageCount(bytes('/Type /Pages /Type /Page /Type/Page'))).toBe(2);
    expect(pdfPageCount(bytes('compressed'))).toBeNull();
  });
});

describe('withinRequest', () => {
  it('names as unread the files past what one request carries', () => {
    const big = 'x'.repeat(Math.ceil((SEND_MAX_BYTES * 4) / 3) - 10);
    const files: DashFile[] = [
      { name: 'a.pdf', kind: 'pdf', data: big },
      { name: 'b.png', kind: 'image', mediaType: 'image/png', data: 'yyyyyyyyyyyyyyyyyyyy' },
      { name: 'c.txt', kind: 'text', text: 'hi' },
    ];
    expect(withinRequest(files).map((file) => file.kind)).toEqual(['pdf', 'unread', 'text']);
  });
});

describe('fileBlocks and withNewestFiles', () => {
  const files: DashFile[] = [
    { name: 'bill.png', kind: 'image', mediaType: 'image/png', data: 'AAA' },
    { name: 'bill.pdf', kind: 'pdf', data: 'BBB' },
    { name: 'notes.txt', kind: 'text', text: 'due 3 Nov' },
    { name: 'old.doc', kind: 'unread', why: 'an old .doc file cannot be read' },
  ];

  it('puts the files before the newest question and leaves earlier turns alone', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'first (Sent with this: a.png)' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'what is the due date on this bill?' },
    ];
    const out = withNewestFiles(messages, files);
    expect(out.slice(0, 2)).toEqual(messages.slice(0, 2));
    const content = out[2].content as Anthropic.ContentBlockParam[];
    expect(content.map((block) => block.type)).toEqual(['text', 'image', 'document', 'text', 'text', 'text']);
    expect(content[2]).toMatchObject({ title: 'bill.pdf', source: { media_type: 'application/pdf', data: 'BBB' } });
    expect(content[3]).toMatchObject({ text: expect.stringContaining('due 3 Nov') });
    expect(content[4]).toMatchObject({ text: expect.stringContaining('old.doc') });
    expect(content[5]).toEqual({ type: 'text', text: 'what is the due date on this bill?' });
    expect(withNewestFiles(messages, [])).toBe(messages);
  });

  it('sends nothing extra for no files', () => {
    expect(fileBlocks([])).toEqual([]);
  });
});

describe('askDash with files', () => {
  it('reads the newest question’s files and names the earlier ones only', async () => {
    const sent: Anthropic.MessageCreateParams[] = [];
    const client = {
      messages: {
        create: async (params: Anthropic.MessageCreateParams) => {
          sent.push(structuredClone(params));
          return {
            content: [{ type: 'tool_use', id: 'u1', name: 'answer', input: { answer: 'It is due on 3 November.', cited: [] } }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    } as unknown as Anthropic;
    const earlier: TalkTurn[] = [
      {
        id: 'old-q',
        role: 'user',
        body: 'What is this?',
        createdAt: '2026-10-01T10:00:00Z',
        files: [{ id: 'f0', name: 'receipt.png', contentType: 'image/png', size: 10, href: '/attachments/f0' }],
      },
      { id: 'old-a', role: 'assistant', body: 'A receipt.', createdAt: '2026-10-01T10:00:05Z' },
    ];
    const read: string[] = [];
    const stores: AskStores = {
      start: async () => ({ kind: 'ask', ref: 'conv', title: null }),
      load: async () => earlier,
      append: async (_subject, turns: readonly NewTalkTurn[]) =>
        turns.map((turn, i) => ({
          id: `new-${i}`,
          role: turn.role,
          body: turn.body,
          createdAt: '2026-10-09T10:00:00Z',
          ...(turn.files?.length
            ? { files: turn.files.map((f) => ({ id: f.path, name: f.name, contentType: f.contentType, size: f.size, href: '' })) }
            : {}),
        })),
      readFiles: async (turnId) => {
        read.push(turnId);
        return [{ name: 'bill.pdf', kind: 'pdf', data: 'JVBERi0=' }];
      },
      recordSpend: async () => {},
      saveProposal: async () => {
        throw new Error('no proposals');
      },
      attachProposals: async () => {},
      discardProposals: async () => {},
    };
    const result = await askDash(
      {
        question: 'What is the due date on this bill?',
        conversationRef: 'conv',
        files: [{ path: 'u/1-bill.pdf', name: 'bill.pdf', contentType: 'application/pdf', size: 1000 }],
        today: '2026-10-09',
        execute: async () => ({ ok: true, rows: [] }),
        anthropicApiKey: 'test',
        client,
      },
      stores,
    );
    expect(result.error).toBeUndefined();
    expect(read).toEqual(['new-0']);
    const messages = sent[0].messages;
    expect(messages[0].content).toContain('(Sent with this: receipt.png)');
    const last = messages[messages.length - 1].content as Anthropic.ContentBlockParam[];
    expect(last[0]).toMatchObject({ type: 'document', title: 'bill.pdf' });
    const words = last[last.length - 1];
    expect(words).toEqual({ type: 'text', text: 'What is the due date on this bill?' });
  });
});

describe('filesEstimate', () => {
  it('rises with the files, and is a guess', () => {
    const one = filesEstimate([{ contentType: 'image/png', size: 2_000_000 }], ASK_MODEL)!;
    const two = filesEstimate(
      [
        { contentType: 'image/png', size: 2_000_000 },
        { contentType: 'application/pdf', size: 500_000 },
      ],
      ASK_MODEL,
    )!;
    expect(one.medianMicros).toBeGreaterThan(0);
    expect(two.medianMicros).toBeGreaterThan(one.medianMicros);
    expect(one.lowMicros).toBeLessThan(one.medianMicros);
    expect(one.highMicros).toBeGreaterThan(one.medianMicros);
    expect(one.basis).toBe('guess');
    expect(filesEstimate([], ASK_MODEL)).toBeNull();
    expect(filesEstimate([{ contentType: 'application/msword', size: 9 }], ASK_MODEL)).toBeNull();
  });

  it('guesses a PDF’s pages from its size, within the model’s limit', () => {
    expect(fileTokens({ contentType: 'application/pdf', size: 10 })).toBe(2_500);
    expect(fileTokens({ contentType: 'application/pdf', size: 50_000_000 })).toBe(250_000);
    expect(fileTokens({ contentType: 'text/plain', size: 400 })).toBe(100);
  });
});

import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { ASK_CHART_ONLY, ASK_MAKES_FILES, askDash, type AskStores } from './ask';
import { NOTHING_ATTACHED_ASK } from '@/lib/talk/attachment-claim';
import type { MadeFile } from '@/lib/talk/made-files';
import type { NewTalkTurn, TalkTurn } from '@/lib/talk/talk';

/** Ask Dash sends back the files its code makes, under its answer (plan #3050.3.2). */

const usage = { input_tokens: 10, output_tokens: 10 };
const answerReply = (answer: string) => ({
  content: [{ type: 'tool_use', id: 'a', name: 'answer', input: { answer, cited: [] } }],
  stop_reason: 'tool_use',
  usage,
});

type Served = { filename: string; mime_type: string; size_bytes: number; bytes: number[] };

const PNG: Served = { filename: 'markets.png', mime_type: 'image/png', size_bytes: 4, bytes: [137, 80, 78, 71] };
const PDF: Served = { filename: 'markets.pdf', mime_type: 'application/pdf', size_bytes: 4, bytes: [37, 80, 68, 70] };
const SVG: Served = { filename: 'markets.svg', mime_type: 'image/svg+xml', size_bytes: 9, bytes: [60] };

/**
 * Stores and a client whose first round runs code that writes `files` (by
 * file id), and whose second answers with `answer`; `get` serves the Files
 * API. With `keep` false the stores keep no files.
 */
function harness(answer: string, files: Record<string, Served>, keep = true) {
  const kept: NewTalkTurn[] = [];
  const amended: { turnId: string; body: string }[] = [];
  const keptFiles: { turnId: string; names: string[] }[] = [];
  const requests: Record<string, unknown>[] = [];
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
    recordSlip: async () => {},
  };
  if (keep) {
    stores.keepFiles = async (turnId: string, made: readonly MadeFile[]) => {
      keptFiles.push({ turnId, names: made.map((f) => f.name) });
      return {
        kept: made.map((f, i) => ({ id: `f${i}`, name: f.name, contentType: f.contentType, size: f.bytes.byteLength, href: `/attachments/f${i}` })),
        unkept: [],
      };
    };
    stores.amendAnswer = async (turnId: string, body: string) => void amended.push({ turnId, body });
  }
  const ran = Object.keys(files).length > 0;
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        requests.push(params);
        if (requests.length > 1 || !ran) return answerReply(answer);
        return {
          content: [
            { type: 'server_tool_use', id: 's1', name: 'bash_code_execution', input: { command: 'python chart.py' } },
            {
              type: 'bash_code_execution_tool_result',
              tool_use_id: 's1',
              content: {
                type: 'bash_code_execution_result',
                stdout: '',
                stderr: '',
                return_code: 0,
                content: Object.keys(files).map((file_id) => ({ type: 'bash_code_execution_output', file_id })),
              },
            },
          ],
          container: { id: 'container_1' },
          stop_reason: 'pause_turn',
          usage,
        };
      },
    },
    get: async (path: string) => {
      const id = /\/v1\/files\/([^/]+)/.exec(path)?.[1] ?? '';
      const file = files[id];
      if (!file) throw new Error('no such file');
      if (path.endsWith('/content')) return new Response(new Uint8Array(file.bytes));
      return { filename: file.filename, mime_type: file.mime_type, size_bytes: file.size_bytes };
    },
  } as unknown as Anthropic;
  const execute = async () => ({ ok: true as const, rows: [] });
  const ask = (question = 'Send me the markets chart as an image') =>
    askDash({ question, today: '2026-11-07', execute, anthropicApiKey: 'k', client }, stores);
  return { stores, ask, kept, amended, keptFiles, requests };
}

const toolNames = (request: Record<string, unknown>) => (request.tools as { name: string }[]).map((t) => t.name);
const systemText = (request: Record<string, unknown>) => JSON.stringify(request.system);
const asJson = (text: string) => JSON.stringify(text).slice(1, -1);

describe('Ask Dash and the files its code makes (plan #3050.3.2)', () => {
  it('offers code execution and the file rules only where the files are kept', async () => {
    const without = harness('Fine.', {}, false);
    await without.ask();
    expect(toolNames(without.requests[0])).not.toContain('code_execution');
    expect(systemText(without.requests[0])).toContain(asJson(ASK_CHART_ONLY));

    const withFiles = harness('Fine.', {});
    await withFiles.ask();
    expect(toolNames(withFiles.requests[0])).toContain('code_execution');
    expect(systemText(withFiles.requests[0])).toContain(asJson(ASK_MAKES_FILES));
    expect(systemText(withFiles.requests[0])).not.toContain(asJson(ASK_CHART_ONLY));
  });

  it('keeps the picture and the PDF its code made under the answer, and lets the answer say so', async () => {
    const h = harness("Here's the markets chart as a picture, and the same as a PDF.", { file_png: PNG, file_pdf: PDF });
    const result = await h.ask();
    expect(h.keptFiles).toEqual([{ turnId: 't2', names: ['markets.png', 'markets.pdf'] }]);
    expect(h.amended).toEqual([]);
    const answer = result.turns.at(-1);
    expect(answer?.body).toBe("Here's the markets chart as a picture, and the same as a PDF.");
    expect(answer?.files?.map((f) => [f.name, f.contentType])).toEqual([
      ['markets.png', 'image/png'],
      ['markets.pdf', 'application/pdf'],
    ]);
    // The second round runs in the container the first one made.
    expect(h.requests[1].container).toBe('container_1');
  });

  it('says in the answer which file could not be saved, and why', async () => {
    const h = harness("Here's the chart.", { file_png: PNG, file_svg: SVG });
    const result = await h.ask();
    expect(h.keptFiles).toEqual([{ turnId: 't2', names: ['markets.png'] }]);
    expect(h.amended).toHaveLength(1);
    expect(h.amended[0].turnId).toBe('t2');
    expect(h.amended[0].body).toMatch(/^Here's the chart\.\n\nSorry, a file did not come through\. markets\.svg could not be saved: /);
    expect(result.turns.at(-1)?.body).toBe(h.amended[0].body);
    expect(result.turns.at(-1)?.files?.map((f) => f.name)).toEqual(['markets.png']);
  });

  it('says every file was not saved when keeping them fails', async () => {
    const h = harness("Here's the chart.", { file_png: PNG });
    h.stores.keepFiles = async () => {
      throw new Error('storage down');
    };
    const result = await h.ask();
    expect(result.turns.at(-1)?.body).toContain('markets.png could not be saved: it could not be kept with the answer.');
    expect(result.turns.at(-1)?.files).toBeUndefined();
  });

  it('ends a claim of a file its code did not make with the sentence for Ask', async () => {
    const h = harness('I have attached the PDF.', {});
    await h.ask('Send me a PDF');
    expect(h.kept.at(-1)?.body).toBe(`I have attached the PDF.\n\n${NOTHING_ATTACHED_ASK}`);
  });
});

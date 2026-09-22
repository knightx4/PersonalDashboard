import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { chunkNote, type NoteChunk } from '@/lib/learn/graph/note-chunks';
import {
  MAP_EDGE_TOOL_FIELD,
  POSITION_KIND_TOOL_FIELD,
  POSITION_RULE,
} from '@/lib/learn/graph/position-prompt';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { classifyForMap } from '@/lib/vault/map/classify';
import {
  mergeChunkReports,
  readChunkReport,
  READ_STANCES,
  type ChunkReport,
  type NoteMapProposal,
} from '@/lib/vault/map/proposal';
import {
  isGenerated,
  readsForMap,
  whyNotRead,
  type MapVerdict,
  type NotRead,
} from '@/lib/vault/map/rules';

/**
 * Stages 0 to 2 of LEARN-MAP-SPEC.md for one note: classify it, cut it into
 * chunks, and read each chunk for the themes it covers and the positions it
 * argues. The result is a proposal and nothing more. It is written to the map
 * only when somebody accepts it, through `acceptNoteMap`.
 *
 * What is sent: the note's title, a chunk's heading and the chunk's text, and
 * the names of themes the person already has. Never the note's path or
 * folder, which the privacy page promises. A journal, or a note carrying an
 * API key, is refused before anything is sent.
 *
 * Haiku, one call per chunk, a few at a time. The sweep (plan #757) calls
 * this once per note and adds what this deliberately has none of: a budget, a
 * resume point and a run record.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_note_map';

/** Chunks read at once. Enough to keep a long note under a minute. */
const CHUNKS_AT_ONCE = 4;

/** Existing theme names sent with each chunk, so the model reuses them. */
const MAX_EXISTING_THEMES = 200;

const SYSTEM = `You are reading one section of somebody's personal note, to map
what they write about and what they argue.

THEMES. Name the one to three subjects this section is about, as short labels
for a list: "Urbanism", "How people learn", "Value and price". Give each one
line on what it covers, in the writer's terms. A theme is a label over a body
of writing and does not have to pass any test. Where one of the existing
themes you are given fits, use its name exactly as written rather than a
variant of it.

POSITIONS. Then the specific things the section argues, each under the themes
it belongs to, named exactly as you named them above.

${POSITION_RULE}

STANCE. "held" when the writer argues it in their own words. "encountered"
when they are recording somebody else's idea: a quotation, a clipping, a
summary of what an author says.

AS MANY AS THERE ARE. A dense section can hold ten positions and a thin one
none. Do not state one idea several ways to fill the list.

BASIS. Each position says in one short sentence how you know the note holds or
records it.

EDGES name the two positions by the names you gave them.

IF THE SECTION ARGUES NOTHING, report its themes and no positions.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Report the themes this section covers and the positions it argues.',
  input_schema: {
    type: 'object' as const,
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, about: { type: 'string' } },
          required: ['name', 'about'],
        },
      },
      positions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            statement: { type: 'string' },
            kind: POSITION_KIND_TOOL_FIELD,
            stance: { type: 'string', enum: [...READ_STANCES] },
            quote: { type: 'string' },
            basis: { type: 'string' },
            themes: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'statement', 'kind', 'stance', 'quote', 'basis', 'themes'],
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            type: MAP_EDGE_TOOL_FIELD,
            description: { type: 'string' },
          },
          required: ['from', 'to', 'type', 'description'],
        },
      },
    },
    required: ['themes', 'positions', 'edges'],
  },
};

export type MapNote = {
  id: string;
  /** Read only to refuse a journal. Never sent. */
  path: string;
  title: string;
  /** Front matter already removed, as `NoteDetail.body` has it. */
  body: string;
  blobSha: string;
};

export type ProposeResult =
  | { ok: true; proposal: NoteMapProposal }
  | { ok: false; reason: 'not-read'; notRead: NotRead; detail: string }
  | { ok: false; reason: 'operational'; verdict: MapVerdict; detail: string }
  | { ok: false; reason: 'nothing-in-it'; verdict: MapVerdict; detail: string }
  | { ok: false; reason: 'error'; detail: string };

type ChunkOutcome = { ok: true; report: ChunkReport } | { ok: false; detail: string };

async function readChunk(
  client: Anthropic,
  title: string,
  chunk: NoteChunk,
  existingThemes: string[],
  onSpend?: SpendSink,
): Promise<ChunkOutcome> {
  const lines = [`Note: ${title}`, `Section: ${chunk.title}`, ''];
  if (existingThemes.length > 0) {
    lines.push('Themes they already have:', ...existingThemes.map((name) => `- ${name}`), '');
  }
  lines.push('The section:', chunk.text, '', `Call ${TOOL_NAME}.`);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'Reading the section failed.',
    };
  }

  onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find(
    (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
  );
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return { ok: true, report: readChunkReport(block.input) };
}

/** `run` over every item, `limit` at a time, results in the items' order. */
async function inBatches<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function proposeNoteMap(input: {
  note: MapNote;
  /** The person's theme names, strongest first. */
  existingThemes?: string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ProposeResult> {
  const { note } = input;

  const notRead = whyNotRead(note);
  if (notRead) return { ok: false, reason: 'not-read', notRead, detail: notRead.detail };

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let verdict: MapVerdict;
  try {
    verdict = await classifyForMap({
      title: note.title,
      body: note.body,
      anthropicApiKey: input.anthropicApiKey,
      client,
      onSpend: input.onSpend,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Classifying the note failed.',
    };
  }

  if (!readsForMap(verdict.noteClass)) {
    return { ok: false, reason: 'operational', verdict, detail: `Not read: ${verdict.reason}` };
  }

  const { chunks, skipped } = chunkNote(note.body);
  const existing = (input.existingThemes ?? []).slice(0, MAX_EXISTING_THEMES);
  const outcomes = await inBatches(chunks, CHUNKS_AT_ONCE, (chunk) =>
    readChunk(client, note.title, chunk, existing, input.onSpend),
  );

  const reports: { chunk: NoteChunk; report: ChunkReport }[] = [];
  const failed: { title: string; detail: string }[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.ok) reports.push({ chunk: chunks[index], report: outcome.report });
    else failed.push({ title: chunks[index].title, detail: outcome.detail });
  });

  if (reports.length === 0) {
    return {
      ok: false,
      reason: 'error',
      detail: failed[0]?.detail ?? 'The note has nothing to read.',
    };
  }

  const merged = mergeChunkReports({ body: note.body, generated: isGenerated(note.body), reports });
  if (merged.themes.length === 0 && merged.positions.length === 0) {
    return {
      ok: false,
      reason: 'nothing-in-it',
      verdict,
      detail: 'The note was read and argues nothing the map can hold.',
    };
  }

  return {
    ok: true,
    proposal: {
      noteId: note.id,
      blobSha: note.blobSha,
      verdict,
      ...merged,
      chunks: { read: reports.length, failed },
      skipped,
    },
  };
}

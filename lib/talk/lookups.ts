import type { AskDashResult, AskLookupEvent } from '@/lib/dash/ask';
import type { TalkToolCall } from './talk';
import { CHART_TOOL } from './chart';

/**
 * What Dash is looking up, in words (plan #1438).
 *
 * While an answer is written the thread shows one line per lookup as it
 * starts ("Searching job applications") and says what it found when it
 * finishes; the finished answer keeps the same lines folded beneath it, read
 * from the turn's toolCalls. Both are drawn from here, so the line that
 * streamed is the line a reopened answer shows.
 *
 * The lines travel from app/api/ask/route.ts as newline-delimited JSON: one
 * `lookup` line per event, then one `result` line with the AskDashResult the
 * server action returns. Nothing here reads a database or the network, so the
 * browser imports it.
 */

/** One lookup as the thread draws it. `found` is null while it runs or when the result says no count. */
export type LookupLine = {
  id: string;
  label: string;
  state: 'running' | 'done' | 'failed';
  found: number | null;
};

/** A lookup as the stream carries it: the event without the result, plus the count the result gave. */
export type LookupWire = {
  phase: 'started' | 'finished';
  id: string;
  index: number;
  name: string;
  input: unknown;
  ok?: boolean;
  found?: number | null;
};

export type AskStreamLine = { lookup: LookupWire } | { result: AskDashResult };

/**
 * The write tools (lib/dash/writes.ts, plan #1440), named here because this
 * file is drawn in the browser and the tools are not; a test holds the two
 * lists together.
 */
export const WRITE_TOOL_NAMES_SHOWN_AS_CARDS: readonly string[] = [
  'add_todo',
  'change_todo',
  'close_todo',
  'add_goal',
  'add_goal_step',
  'close_goal_step',
  'mark_returned',
  'add_role_note',
];

/**
 * Writes and proposals have their cards under the answer, a hand-off says so
 * in the answer and a chart is drawn in it (plan #1655), so the lines are the
 * reads alone.
 */
export function isShownLookup(name: string): boolean {
  return (
    !name.startsWith('propose_') &&
    name !== 'hand_off' &&
    name !== CHART_TOOL &&
    !WRITE_TOOL_NAMES_SHOWN_AS_CARDS.includes(name)
  );
}

const MAX_QUOTED = 60;

function quoted(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return `“${line.length > MAX_QUOTED ? `${line.slice(0, MAX_QUOTED - 1).trimEnd()}…` : line}”`;
}

function field(input: unknown, key: string): unknown {
  return input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
}

/** A table as the person would say it: `vault.notes` is notes, `job_search.contacts` contacts. */
function tableWords(table: unknown): string {
  if (typeof table !== 'string' || !table) return 'rows';
  return (table.split('.').pop() ?? table).replace(/_/g, ' ');
}

/** The line for one lookup, from its tool and what it was asked. */
export function lookupLabel(name: string, input: unknown): string {
  switch (name) {
    case 'search': {
      const q = quoted(field(input, 'query'));
      return q ? `Searching for ${q}` : 'Searching your things';
    }
    case 'recall': {
      const q = quoted(field(input, 'question'));
      return q ? `Looking through what you wrote about ${q}` : 'Looking through what you wrote';
    }
    case 'open_row':
      return `Opening one of your ${tableWords(field(input, 'table'))}`;
    case 'spend_by_merchant': {
      const shop = quoted(field(input, 'merchant'));
      return shop ? `Adding up spending at ${shop}` : 'Adding up spending';
    }
    case 'job_applications':
      return 'Checking job applications';
    case 'todos':
      return 'Checking todos';
    case 'goal_status':
      return 'Checking goals';
    case 'vault_notes': {
      const q = quoted(field(input, 'query'));
      return q ? `Searching vault notes for ${q}` : 'Reading recent vault notes';
    }
    case 'note_positions':
      return 'Reading the notes and positions around a note';
    case 'courses':
      return 'Checking courses';
    case 'read_spec': {
      const spec = field(input, 'spec');
      return typeof spec === 'string' && spec ? `Reading the ${spec} spec` : 'Reading a spec';
    }
    case 'read_dev_row': {
      const kind = field(input, 'kind');
      const ref = field(input, 'ref');
      if (kind === 'step' && typeof ref === 'string' && /^#?\d+$/.test(ref.trim())) {
        return `Reading step #${ref.trim().replace(/^#/, '')}`;
      }
      return kind === 'idea' ? 'Reading an idea' : kind === 'note' ? 'Reading a note' : kind === 'raise' ? 'Reading a raise' : 'Reading a plan step';
    }
    case 'find_dev_text': {
      const q = quoted(field(input, 'query'));
      return q ? `Searching the Dev pages for ${q}` : 'Searching the Dev pages';
    }
    case 'search_mail': {
      const from = quoted(field(input, 'from'));
      const words = quoted(field(input, 'words'));
      if (from) return `Searching email from ${from}`;
      return words ? `Searching email for ${words}` : 'Searching email';
    }
    case 'read_mail':
      return 'Reading an email';
    default:
      return 'Looking something up';
  }
}

/**
 * How many things a lookup's kept result found: the rows it listed, or the
 * count a mail lookup keeps in place of them. Null for a result with neither.
 */
export function foundCount(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.rows)) return r.rows.length;
  if (typeof r.matched === 'number') return r.matched;
  if (typeof r.opened === 'number') return r.opened;
  return null;
}

/** What follows a finished line: how many it found, or that it did not work. */
export function lookupOutcome(line: Pick<LookupLine, 'state' | 'found'>): string | null {
  if (line.state === 'failed') return 'did not work';
  if (line.state === 'running' || line.found === null) return null;
  return line.found === 0 ? 'nothing found' : `${line.found} found`;
}

/** The server's side: an event as one line of the stream, or null for one the thread does not show. */
export function lookupWire(event: AskLookupEvent): LookupWire | null {
  if (!isShownLookup(event.name)) return null;
  const { phase, id, index, name, input } = event;
  if (event.phase === 'started') return { phase, id, index, name, input };
  return { phase, id, index, name, input, ok: event.ok, found: event.ok ? foundCount(event.result) : null };
}

/**
 * The browser's side: the lines so far with one more event heard. A finished
 * event for a lookup never heard starting (one refused at the cap) is added
 * as it finishes.
 */
export function heardLookup(lines: readonly LookupLine[], wire: LookupWire): LookupLine[] {
  const next: LookupLine =
    wire.phase === 'started'
      ? { id: wire.id, label: lookupLabel(wire.name, wire.input), state: 'running', found: null }
      : {
          id: wire.id,
          label: lookupLabel(wire.name, wire.input),
          state: wire.ok ? 'done' : 'failed',
          found: wire.ok ? (wire.found ?? null) : null,
        };
  const at = lines.findIndex((line) => line.id === wire.id);
  if (at === -1) return [...lines, next];
  return lines.map((line, i) => (i === at ? next : line));
}

/** A finished answer's lookups as lines, in the order made, reads only. */
export function turnLookups(calls: readonly TalkToolCall[] | undefined): LookupLine[] {
  return (calls ?? [])
    .filter((call) => isShownLookup(call.name))
    .map((call, i) => {
      const ok = !!call.result && typeof call.result === 'object' && (call.result as { ok?: unknown }).ok === true;
      return {
        id: String(i),
        label: lookupLabel(call.name, call.input),
        state: ok ? 'done' : 'failed',
        found: ok ? foundCount(call.result) : null,
      };
    });
}

/** One line of the stream, newline included. */
export function encodeStreamLine(line: AskStreamLine): string {
  return `${JSON.stringify(line)}\n`;
}

/**
 * Reads the stream to its result, handing each lookup to `onLookup` as it
 * arrives. A stream that ends without a result is a failed answer, said in a
 * sentence; it never throws for that.
 */
export async function readAskStream(
  body: ReadableStream<Uint8Array>,
  onLookup: (wire: LookupWire) => void,
): Promise<AskDashResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AskDashResult | null = null;
  const take = (text: string) => {
    const line = text.trim();
    if (!line) return;
    let parsed: AskStreamLine;
    try {
      parsed = JSON.parse(line) as AskStreamLine;
    } catch {
      return;
    }
    if ('result' in parsed) result = parsed.result;
    else if ('lookup' in parsed) {
      try {
        onLookup(parsed.lookup);
      } catch {
        // A listener that throws must not lose the answer.
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf('\n');
    while (end !== -1) {
      take(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf('\n');
    }
  }
  take(buffer + decoder.decode());
  return result ?? { turns: [], error: STREAM_CUT };
}

/** Said when the answer's stream stopped before the answer came. */
export const STREAM_CUT = 'The answer stopped arriving before it finished. Reopen the question to see whether it was kept.';

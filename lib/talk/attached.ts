import type { TalkToolCall } from './talk';

/**
 * A page or file the app already holds, sent with a bot's reply by reference
 * (plan #3050.4). When the person asks a bot for something they have, such as
 * a goal page Dash wrote, a page a bot made earlier or a file they added, the
 * bot finds it with its lookups and calls `attach_saved` with its table and
 * id. The lookup (lib/ask/attach.ts) reads the row as the person, so only
 * their own is found, and keeps a card for it: the title, what it is, and
 * where it opens.
 *
 * Ask Dash keeps the card as that call's result in the turn's tool_calls,
 * as it does a chart, so a reopened conversation draws it from the turn
 * alone. A People reply keeps it on its last bubble, in
 * you.advisor_messages.attached (you migration 0054). Voice reads the words
 * alone and never offers the tool.
 *
 * Nothing here reads a database or the network, so the thread imports it.
 */

export const ATTACH_SAVED_TOOL = 'attach_saved';

/** The tables a card can come from: a page or piece of writing, or a file they added. */
export const ATTACHABLE_TABLES = ['core.files', 'core.attachments'] as const;
export type AttachableTable = (typeof ATTACHABLE_TABLES)[number];

/** The most cards one reply carries. */
export const MAX_ATTACHED = 3;
const MAX_TITLE = 200;

/**
 * One card under a reply. `kind` is what the card says the thing is: a page
 * (an interactive page a bot made, core.files format html), writing (a
 * markdown file Dash or the person wrote) or a file they added.
 */
export type SavedAttachment = {
  table: AttachableTable;
  id: string;
  title: string;
  kind: 'page' | 'writing' | 'file';
  href: string;
  /** A file's type and size, for its line under the title. */
  contentType?: string;
  size?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The table and id a call names, from `table` and `ref` as a lookup's row
 * gives them, or from a full ref (`core.files:<id>`) in either. Null when it
 * names neither table or no id.
 */
export function attachTarget(input: unknown): { table: AttachableTable; id: string } | null {
  if (!input || typeof input !== 'object') return null;
  const { table, ref } = input as { table?: unknown; ref?: unknown };
  const raw = typeof ref === 'string' ? ref.trim() : '';
  const colon = raw.lastIndexOf(':');
  const named = typeof table === 'string' ? table.trim() : colon > 0 ? raw.slice(0, colon) : '';
  const id = colon > 0 ? raw.slice(colon + 1) : raw;
  if (!(ATTACHABLE_TABLES as readonly string[]).includes(named) || !UUID.test(id)) return null;
  return { table: named as AttachableTable, id: id.toLowerCase() };
}

/** A kept card read back, or null when it is not one: a card that no longer parses draws nothing. */
export function parseSavedAttachment(value: unknown): SavedAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!(ATTACHABLE_TABLES as readonly string[]).includes(String(v.table))) return null;
  if (typeof v.id !== 'string' || !UUID.test(v.id)) return null;
  const title = typeof v.title === 'string' ? v.title.trim().slice(0, MAX_TITLE) : '';
  if (!title) return null;
  if (v.kind !== 'page' && v.kind !== 'writing' && v.kind !== 'file') return null;
  if (typeof v.href !== 'string' || !v.href.startsWith('/')) return null;
  return {
    table: v.table as AttachableTable,
    id: v.id,
    title,
    kind: v.kind,
    href: v.href,
    ...(typeof v.contentType === 'string' ? { contentType: v.contentType } : {}),
    ...(typeof v.size === 'number' && Number.isFinite(v.size) ? { size: v.size } : {}),
  };
}

/** Kept cards read back, each thing once, at most MAX_ATTACHED. */
export function savedAttachmentsOf(value: unknown): SavedAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: SavedAttachment[] = [];
  for (const raw of value) {
    const card = parseSavedAttachment(raw);
    if (!card || out.some((c) => c.table === card.table && c.id === card.id)) continue;
    out.push(card);
    if (out.length === MAX_ATTACHED) break;
  }
  return out;
}

/**
 * The cards a finished answer attached, in the order made, read from its
 * kept tool calls. A call that failed attaches nothing.
 */
export function turnAttached(calls: readonly TalkToolCall[] | undefined): SavedAttachment[] {
  const kept: unknown[] = [];
  for (const call of calls ?? []) {
    if (call.name !== ATTACH_SAVED_TOOL || !call.result || typeof call.result !== 'object') continue;
    const result = call.result as { ok?: unknown; attached?: unknown };
    if (result.ok === true) kept.push(result.attached);
  }
  return savedAttachmentsOf(kept);
}

/** What the model is told once the card is kept. */
export function attachedNote(card: SavedAttachment): string {
  return `"${card.title}" is attached under your reply as a card that opens it. Say in a sentence what you sent; do not paste a link to it as well.`;
}

/** What a bot is told about sending what the person already has, after its other rules. */
export const SAVED_RULES = `YOU CAN SEND A PAGE OR FILE THEY ALREADY HAVE. When they ask for something
already in the app, such as a page Dash wrote for a goal, a page made earlier
in a chat, a piece of writing or a file they added, find it with search (or
the lookup that lists it) and call attach_saved with the table and ref the
lookup gave. It shows under your reply as a card with its title that opens
it, so say in a sentence what you sent. Attach only a row a lookup found,
at most ${MAX_ATTACHED} a reply, and never write that you sent one you did not attach.`;

/** The tool's definition, sent to the model with the lookups (lib/ask/tools.ts). */
export const ATTACH_SAVED_DEFINITION = {
  name: ATTACH_SAVED_TOOL,
  description: `Attach something the person already has in the app under your reply, as a card with its title that opens it: a page or piece of writing in their files (table core.files: a page Dash wrote for a goal, a page a bot made, a file they wrote) or a file they added (table core.attachments). Find it first with search or another lookup and pass the table and ref that lookup returned. Use it when they ask you to send, share, show or give them something they have, rather than describing it or pasting a link. At most ${MAX_ATTACHED} a reply.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      table: { type: 'string', enum: [...ATTACHABLE_TABLES], description: 'core.files or core.attachments, as the lookup gave it.' },
      ref: { type: 'string', description: 'The id the lookup gave for the row.' },
    },
    required: ['table', 'ref'],
    additionalProperties: false,
  },
};

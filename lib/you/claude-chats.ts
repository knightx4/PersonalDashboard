import { unzipSync } from 'fflate';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * What the person said in their chats with Claude (you.claude_chats, you
 * 0019), for the insights runs: their own messages from the claude.ai data
 * export, and what save_about_me saved during a chat.
 *
 * The export is read in their browser (readClaudeExport), so a zip of years
 * of chats is never uploaded whole: only their own messages are sent on, in
 * batches small enough for a server action (chatBatches). Claude's replies are
 * dropped where the file is read.
 */

/** One of their messages, as imported. */
export type ChatLine = {
  messageId: string;
  conversationId: string | null;
  conversationTitle: string | null;
  saidAt: string;
  body: string;
};

/** The most of one message kept; a longer one is cut here. */
export const CHAT_BODY_MAX = 20_000;
const TITLE_MAX = 300;
const ID_MAX = 100;
/** A batch stays under the 1 MB a server action takes, with room to spare. */
const BATCH_CHARS = 400_000;
export const BATCH_ROWS = 500;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A message's text: the text field, or its text parts joined when that is empty. */
function messageText(message: Record<string, unknown>): string {
  const plain = str(message.text).trim();
  if (plain) return plain;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .flatMap((part) =>
      part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text'
        ? [str((part as Record<string, unknown>).text)]
        : [],
    )
    .join('\n')
    .trim();
}

/** Their own messages from a parsed conversations.json; anything else in it is skipped. */
export function linesFromConversations(data: unknown): ChatLine[] {
  if (!Array.isArray(data)) throw new Error('This is not a Claude export: conversations.json should hold a list.');
  const lines: ChatLine[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const conversation = entry as Record<string, unknown>;
    const messages = Array.isArray(conversation.chat_messages) ? conversation.chat_messages : [];
    const conversationId = str(conversation.uuid).slice(0, ID_MAX) || null;
    const conversationTitle = str(conversation.name).trim().slice(0, TITLE_MAX) || null;
    for (const item of messages) {
      if (!item || typeof item !== 'object') continue;
      const message = item as Record<string, unknown>;
      if (message.sender !== 'human') continue;
      const messageId = str(message.uuid).slice(0, ID_MAX);
      const saidAt = str(message.created_at) || str(conversation.created_at);
      const body = messageText(message).slice(0, CHAT_BODY_MAX);
      if (!messageId || !body || Number.isNaN(Date.parse(saidAt))) continue;
      lines.push({ messageId, conversationId, conversationTitle, saidAt, body });
    }
  }
  return lines;
}

const isZip = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;

/**
 * Their messages from the file they chose: the export's zip, or the
 * conversations.json inside it.
 */
export function readClaudeExport(bytes: Uint8Array): ChatLine[] {
  let json = bytes;
  if (isZip(bytes)) {
    const files = unzipSync(bytes, { filter: (file) => /(^|\/)conversations\.json$/.test(file.name) });
    const found = Object.values(files)[0];
    if (!found) throw new Error('There is no conversations.json in this zip. Choose the zip claude.ai emailed you.');
    json = found;
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new Error('This file could not be read. Choose the zip claude.ai emailed you, or conversations.json from inside it.');
  }
  return linesFromConversations(data);
}

/** The lines in batches a server action can take. */
export function chatBatches(lines: readonly ChatLine[]): ChatLine[][] {
  const batches: ChatLine[][] = [];
  let current: ChatLine[] = [];
  let size = 0;
  for (const line of lines) {
    const weight = line.body.length + (line.conversationTitle?.length ?? 0) + 200;
    if (current.length && (current.length >= BATCH_ROWS || size + weight > BATCH_CHARS)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += weight;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Adds a batch of their messages, skipping any already imported (by the
 * export's message id). Returns how many were new.
 */
export async function importChatLines(
  client: YouSupabaseClient,
  userId: string,
  lines: readonly ChatLine[],
): Promise<number> {
  if (lines.length === 0) return 0;
  const { data, error } = await client
    .from('claude_chats')
    .upsert(
      lines.map((line) => ({
        user_id: userId,
        origin: 'export',
        message_id: line.messageId,
        conversation_id: line.conversationId,
        conversation_title: line.conversationTitle,
        said_at: line.saidAt,
        body: line.body,
      })),
      { onConflict: 'user_id,message_id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`Importing your chats failed: ${error.message}`);
  return data?.length ?? 0;
}

/** What the tab says about their chats: how many, from when, and when last imported. */
export type ChatStats = {
  imported: number;
  saved: number;
  firstSaidAt: string | null;
  lastSaidAt: string | null;
  lastImportedAt: string | null;
};

export async function chatStats(client: YouSupabaseClient, userId: string): Promise<ChatStats> {
  const count = async (origin: 'export' | 'saved') => {
    const { count: n, error } = await client
      .from('claude_chats')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('origin', origin);
    if (error) throw new Error(`Reading your chats failed: ${error.message}`);
    return n ?? 0;
  };
  const edge = async (column: 'said_at' | 'created_at', ascending: boolean) => {
    const { data, error } = await client
      .from('claude_chats')
      .select(column)
      .eq('user_id', userId)
      .eq('origin', 'export')
      .order(column, { ascending })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Reading your chats failed: ${error.message}`);
    const value = (data as Record<string, unknown> | null)?.[column];
    return typeof value === 'string' ? value : null;
  };
  const [imported, saved, firstSaidAt, lastSaidAt, lastImportedAt] = await Promise.all([
    count('export'),
    count('saved'),
    edge('said_at', true),
    edge('said_at', false),
    edge('created_at', false),
  ]);
  return { imported, saved, firstSaidAt, lastSaidAt, lastImportedAt };
}

/** The most save_about_me keeps of what they said, and of why. */
export const ABOUT_ME_MAX = 4000;
export const ABOUT_ME_WHY_MAX = 500;

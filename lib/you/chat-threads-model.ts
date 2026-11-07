import { filesOnlyText } from '@/lib/attachments/rules';
import { whenDay, whenTime, zoneDay } from '@/lib/core/when';
import { receiptsOf, type CouncilReceipt } from '@/lib/you/council-model';
import { parseChart, type DashChart } from '@/lib/talk/chart';

/**
 * The People tab's threads (plan #2748.6), kept pure so the tests fix the
 * clock: the rows of the list, the messages of a thread, how they fall into
 * days and groups, and what is said under your last message.
 *
 * A thread is one you.advisor_chats row per mentor (you 0038). Its messages
 * are you.advisor_messages: yours (role person) and the mentor's (role
 * advisor, of kind reply, ack or text_first). The mentor is typing while
 * now() is before typing_until, and their messages after last_read_at are
 * unread until you open the thread.
 */

/** How many messages a thread opens with, and how many each scroll back adds. */
export const THREAD_PAGE = 50;
/** The most messages a search shows. */
export const SEARCH_MAX = 30;
/** The longest search the box takes. */
export const SEARCH_TEXT_MAX = 200;
/** Two messages from one sender further apart than this start a new group. */
export const GROUP_GAP_MS = 10 * 60 * 1000;

export const THREAD_MESSAGE_COLUMNS = 'id, chat_id, role, kind, text, receipts, charts, created_at, delivered_at, read_at, speaker_id';

export type MessageKind = 'reply' | 'ack' | 'text_first';

export type ThreadMessage = {
  id: string;
  chatId: string;
  role: 'person' | 'advisor';
  kind: MessageKind;
  text: string;
  receipts: CouncilReceipt[];
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  /** In a group, the bot that wrote it (plan #2879.1.3); null or absent elsewhere. */
  speakerId?: string | null;
  /**
   * The pictures and PDFs the person sent with it (plan #2974), kept in
   * core.attachments under messageFilesRef; absent when there are none. A
   * Realtime row never carries them, so a merge keeps the copy that does.
   */
  files?: ThreadFile[];
  /**
   * The charts a bot drew with this bubble (plan #3050.2.2), from
   * you.advisor_messages.charts through parseChart; absent when none. Kept
   * out of `text`, so voice reads the words alone.
   */
  charts?: DashChart[];
};

/** The most charts one bubble keeps, as you 0052's check allows. */
export const MAX_BUBBLE_CHARTS = 4;

/** The charts a row keeps, each read again through parseChart; one that no longer parses draws nothing. */
export function chartsOf(value: unknown): DashChart[] {
  if (!Array.isArray(value)) return [];
  const charts: DashChart[] = [];
  for (const raw of value.slice(0, MAX_BUBBLE_CHARTS)) {
    const parsed = parseChart(raw);
    if (parsed.ok) charts.push(parsed.chart);
  }
  return charts;
}

/** A file sent with a message, as the thread draws it: `href` opens it through a short signed link. */
export type ThreadFile = { id: string; name: string; contentType: string; size: number; href: string };

/** The ref a message's files are recorded under in core.attachments. */
export function messageFilesRef(messageId: string): string {
  return `you.advisor_messages:${messageId}`;
}

export { filesOnlyText };

/** The words a message's bubble shows, or null when it carries files and nothing else. */
export function bubbleText(m: Pick<ThreadMessage, 'text' | 'files'>): string | null {
  if (m.files && m.files.length > 0 && m.text === filesOnlyText(m.files.map((f) => f.name))) return null;
  return m.text;
}

/** A page of a thread, oldest first, and whether there is more before it. */
export type ThreadPage = { messages: ThreadMessage[]; hasOlder: boolean };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => str(value) || null;

/** A message row as the database or Realtime gives it, or null when it is not one. */
export function threadMessageOf(row: Record<string, unknown>): ThreadMessage | null {
  const text = str(row.text);
  if (typeof row.id !== 'string' || !text || !str(row.created_at)) return null;
  const kind: MessageKind = row.kind === 'ack' || row.kind === 'text_first' ? row.kind : 'reply';
  const charts = chartsOf(row.charts);
  return {
    id: row.id,
    chatId: str(row.chat_id),
    role: row.role === 'advisor' ? 'advisor' : 'person',
    kind,
    text,
    receipts: receiptsOf(row.receipts),
    createdAt: str(row.created_at),
    deliveredAt: strOrNull(row.delivered_at),
    readAt: strOrNull(row.read_at),
    speakerId: strOrNull(row.speaker_id),
    ...(charts.length > 0 ? { charts } : {}),
  };
}

/** How far a message's receipts have got: read, delivered, neither. */
const progress = (m: ThreadMessage): number => (m.readAt ? 2 : m.deliveredAt ? 1 : 0);

/**
 * Messages oldest first, each id once. Of two copies the incoming one wins
 * unless the other's receipts are further on: Realtime sends a row again when
 * its receipts change, and the copy a send keeps has none. The files either
 * copy carries are kept, since a Realtime row has none.
 */
export function mergeMessages(list: readonly ThreadMessage[], incoming: readonly ThreadMessage[]): ThreadMessage[] {
  const byId = new Map<string, ThreadMessage>();
  for (const m of list) byId.set(m.id, m);
  for (const m of incoming) {
    const had = byId.get(m.id);
    if (had && progress(m) < progress(had)) {
      if (!had.files && m.files) byId.set(m.id, { ...had, files: m.files });
      continue;
    }
    byId.set(m.id, !m.files && had?.files ? { ...m, files: had.files } : m);
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** The mentor is typing while now is before typing_until. */
export function isTyping(typingUntil: string | null, now: number): boolean {
  if (!typingUntil) return false;
  const until = Date.parse(typingUntil);
  return Number.isFinite(until) && until > now;
}

// ---------------------------------------------------------------------------
// The mentor's colour.
// ---------------------------------------------------------------------------

/**
 * The colours a mentor's avatar is drawn in when they have none of their
 * own, each dark enough to carry white initials at 4.5:1 in either theme.
 */
export const MENTOR_PALETTE = [
  '#4a5fd0',
  '#8a6d3b',
  '#2f7d4f',
  '#b0527a',
  '#7a4fb0',
  '#b04a3a',
  '#3d7690',
  '#6b6b3a',
] as const;

/** Their own colour when it is set, else one picked from the key, so a mentor keeps theirs. */
export function mentorColour(key: string, colour: string | null): string {
  if (colour && /^#[0-9a-f]{6}$/.test(colour)) return colour;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return MENTOR_PALETTE[hash % MENTOR_PALETTE.length];
}

/** Up to two initials from a name, skipping a leading "The": "The CFO" is "C", "Ben Franklin" is "BF". */
export function personInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.length > 1 && words[0].toLowerCase() === 'the' ? words.slice(1) : words;
  const letters = kept.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

// ---------------------------------------------------------------------------
// The list.
// ---------------------------------------------------------------------------

/** One person in the People list. */
export type PersonRow = {
  /** The mentor's id, which the send names. */
  id: string;
  key: string;
  name: string;
  /** Their area in a word or two ("Money"), under their name in the thread; empty when there is none. */
  about: string;
  colour: string;
  canTalk: boolean;
  chatId: string | null;
  last: { text: string; role: 'person' | 'advisor'; at: string } | null;
  unread: boolean;
  typingUntil: string | null;
  lastReadAt: string | null;
  /**
   * Why the reply to the person's last message could not be written (plan
   * #2854.4), from you.advisor_chats.reply_status 'failed'; null or absent
   * when nothing failed. The thread says so with Try again.
   */
  replyFailed?: string | null;
  /** A signed link to the picture the person uploaded for them (plan #2955); null or absent draws their initials. */
  photo?: string | null;
};

/** Said when a failed reply kept no reason. */
export const MENTOR_REPLY_FAILED = 'The reply could not be written.';

/** The failure a thread shows, from the chat's reply columns; null unless the reply failed. */
export function replyFailedOf(row: { reply_status?: unknown; reply_error?: unknown }): string | null {
  if (row.reply_status !== 'failed') return null;
  return (typeof row.reply_error === 'string' && row.reply_error.trim()) || MENTOR_REPLY_FAILED;
}

/** Newest thread first; people with nothing said yet after them, by name. */
export function sortPeople(rows: readonly PersonRow[]): PersonRow[] {
  return [...rows].sort((a, b) => {
    if (a.last && b.last) return b.last.at.localeCompare(a.last.at);
    if (a.last) return -1;
    if (b.last) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** The line under a name: their typing, the last thing said, or an invitation to start. */
export function previewOf(row: PersonRow, now: number): string {
  if (isTyping(row.typingUntil, now)) return 'typing…';
  if (row.last) return row.last.role === 'person' ? `You: ${row.last.text}` : row.last.text;
  return row.canTalk ? 'Say hello' : 'Not ready to talk yet';
}

/**
 * The Messages list (plan #2879.2): only the people and bots you have a chat
 * with. Everyone else is reached through New message, which starts one.
 */
export function withChats(rows: readonly PersonRow[], open: string | null = null): PersonRow[] {
  // The open thread keeps a row, lit, even before it has a chat, so the list
  // always says whose thread is beside it.
  return rows.filter((r) => r.chatId !== null || r.key === open);
}

/** Who New message offers, A to Z: everyone, those ready to talk first. */
export function recipientsOf(rows: readonly PersonRow[]): PersonRow[] {
  return [...rows].sort((a, b) => Number(b.canTalk) - Number(a.canTalk) || a.name.localeCompare(b.name));
}

/** The Bots tab's list (plan #2879.3): every bot on the roster, A to Z by name, chat or none. */
export function botsOf(rows: readonly PersonRow[]): PersonRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The quiet line under a bot's name on the Bots tab: what it is for, or that it cannot talk yet. */
export function botLineOf(row: Pick<PersonRow, 'about' | 'canTalk'>): string {
  if (row.canTalk) return row.about;
  return row.about ? `${row.about} · not ready to talk yet` : 'Not ready to talk yet';
}

/** Who New message shows for what is typed in its To box: a name holding those letters. */
export function filterRecipients(rows: readonly PersonRow[], typed: string): PersonRow[] {
  const q = typed.trim().toLowerCase();
  return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : [...rows];
}

/** Where New message opens: the picker of who to message, in the thread's place. */
export const NEW_MESSAGE_HREF = '/chat?new=1';

/** Where a person's thread is. */
export function threadHref(key: string): string {
  return `/chat/people/${key}`;
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole days from zone day `b` to zone day `a`, each written YYYY-MM-DD. */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * A thread's time in the list, as a texting app writes it (the reference):
 * the clock today ("7:12 AM"), "Yesterday", the short weekday within the week
 * ("Sun"), and the month and day before that ("Oct 29"), with the year when
 * it is not this one.
 */
export function threadTime(at: string, options: { timeZone: string; now: number }): string {
  const day = zoneDay(at, options.timeZone);
  const today = zoneDay(options.now, options.timeZone);
  const diff = dayDiff(today, day);
  // Today's clock keeps its AM or PM, as every time in the app does.
  if (diff <= 0) return whenTime(at, options);
  if (diff === 1) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  if (diff <= 6) return SHORT_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const text = `${SHORT_MONTHS[m - 1]} ${d}`;
  return y === Number(today.slice(0, 4)) ? text : `${text}, ${y}`;
}

/** The quiet line under a thread's name: what they are on the council for, then how soon they answer. */
export function threadDetail(row: Pick<PersonRow, 'about' | 'canTalk'>): string {
  const pace = row.canTalk ? 'usually replies right away' : 'not ready to talk yet';
  return row.about ? `${row.about} · ${pace}` : pace[0].toUpperCase() + pace.slice(1);
}

/** What each seat is on the council for, in a word or two, as the reference's "Money". */
const SEAT_AREAS: Record<string, string> = {
  cfo: 'Money',
  hiring_manager: 'Job search',
  mentor: 'Career',
  skeptic: 'Pushes back',
  dreamer: 'Ambitions',
};

/** The longest area kept whole, so "<area> · usually replies right away" fits one line on a phone. */
const AREA_MAX = 12;

/**
 * A mentor's area in a word, as the reference's "Money": a seat's from the
 * list above, anyone else's the first phrase of their focus, cut to its
 * last word when that phrase is long ("Practical habits, thrift, …" is
 * "Habits"), or nothing when even that is long.
 */
export function seatAreaOf(advisor: { key: string; kind: 'seat' | 'guest'; focus: string | null }): string {
  if (advisor.kind === 'seat' && SEAT_AREAS[advisor.key]) return SEAT_AREAS[advisor.key];
  const first = (advisor.focus ?? '').split(/[,.:;]/)[0]?.trim() ?? '';
  const area = first.length > AREA_MAX ? (first.split(/\s+/).at(-1) ?? '') : first;
  if (!area || area.length > AREA_MAX) return '';
  return area[0].toUpperCase() + area.slice(1);
}

/** The search as kept: trimmed and cut to the box's length, or null for nothing to look for. */
export function searchTextOf(value: unknown): string | null {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, SEARCH_TEXT_MAX) : '';
  return text || null;
}

/** A message a search found, with whose thread it is in. */
export type SearchHit = {
  id: string;
  key: string;
  name: string;
  colour: string;
  role: 'person' | 'advisor';
  text: string;
  at: string;
};

// ---------------------------------------------------------------------------
// The thread.
// ---------------------------------------------------------------------------

export type ThreadBlock =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'group'; key: string; from: 'you' | 'them'; messages: ThreadMessage[]; speakerId?: string | null };

/**
 * The thread as it is drawn: a day label wherever the day changes, and
 * consecutive messages from one sender grouped while they are under ten
 * minutes apart.
 */
export function threadBlocks(messages: readonly ThreadMessage[], options: { timeZone: string; now: number }): ThreadBlock[] {
  const out: ThreadBlock[] = [];
  let day: string | null = null;
  let group: Extract<ThreadBlock, { kind: 'group' }> | null = null;
  let lastAt = 0;
  for (const m of messages) {
    const d = zoneDay(m.createdAt, options.timeZone);
    if (d !== day) {
      day = d;
      group = null;
      out.push({ kind: 'day', key: `day-${d}`, label: whenDay(m.createdAt, options) });
    }
    const from = m.role === 'person' ? 'you' : 'them';
    const at = Date.parse(m.createdAt);
    // In a group a run is one bot's: a different bot starts a new one (plan #2879.1.3).
    const speakerId = from === 'them' ? (m.speakerId ?? null) : null;
    if (!group || group.from !== from || (group.speakerId ?? null) !== speakerId || at - lastAt > GROUP_GAP_MS) {
      group = { kind: 'group', key: `group-${m.id}`, from, messages: [], speakerId };
      out.push(group);
    }
    group.messages.push(m);
    lastAt = at;
  }
  return out;
}

/**
 * What is said under your last message while it is the newest in the
 * thread: Read once the mentor's reply has read it, Delivered once the reply
 * run has it, Sent before either. A message of theirs after it says the rest.
 */
export function receiptOf(messages: readonly ThreadMessage[]): { id: string; label: 'Sent' | 'Delivered' | 'Read' } | null {
  const last = messages.at(-1);
  if (!last || last.role !== 'person') return null;
  return { id: last.id, label: last.readAt ? 'Read' : last.deliveredAt ? 'Delivered' : 'Sent' };
}

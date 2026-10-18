/**
 * A goal's lists as its page shows them (plan #2330.3): one chip per list on
 * the Overview, a panel listing the rows, and a tab of its own for each list
 * once a goal has three or more.
 *
 * Two kinds of list feed it, and the page draws them alike. A goal's own
 * list is a collection with goal_id set (lib/goals/lists.ts) whose rows are
 * records, drafts among them. A linked list is every goals.links row of one
 * list name (lib/goals/links.ts), each read live from the workspace that
 * keeps it, so a reading finished in Learn reads as read here too.
 *
 * Pure, so the chip's line, the columns and the tabs are tested without a
 * database. The reads are in lib/goals/goal-lists-store.ts.
 */

import { liveFields, type CollectionField, type FieldValue } from '@/lib/goals/collections';
import type { CollectionRecord } from '@/lib/goals/collections-store';
import { displayValue } from '@/lib/goals/information';
import type { GoalList } from '@/lib/goals/lists-store';
import type { LinkedList, LinkedRow, ListedKind } from '@/lib/goals/links';
import { formatMoney, type CurrencyCode } from '@/lib/money';
import { whenDate, zoneDay } from '@/lib/core/when';

/** A goal with this many lists or more gives each its own tab. */
export const LIST_TABS_FROM = 3;

/** What a tab of a list is called in the address: `?tab=list-pantry-options`. */
export const LIST_TAB_PREFIX = 'list-';

/** One column of a list's table. */
export type ListColumn = { key: string; label: string; num?: boolean };

/** One row of a list, own or linked, in the words the table draws. */
export type ListRowView = {
  /** The record's id for an own row, the link's id for a linked one. */
  id: string;
  title: string;
  /** Where the row opens: its own page in its workspace, or the pasted page for an own row. */
  href: string | null;
  /** True when `href` leaves the app. */
  external: boolean;
  picture: string | null;
  /** Each column's text, by column key; null or missing is blank. */
  cells: Record<string, string | null>;
  /** Found for you and not yet confirmed. Own rows only. */
  draft: boolean;
  /** Removed from its workspace since it was linked. Linked rows only. */
  gone: boolean;
  /** Set aside: dismissed in Shopping, abandoned in Learn, or marked ruled out. */
  ruledOut: boolean;
  /** Picked, bought or read: what the chip's line names first. */
  picked: boolean;
  /** Comments on the row's own thread, where its table keeps one. */
  comments: number;
};

export type ListView = {
  /** Unique on the goal and safe in an address. */
  key: string;
  /** The collection's id for an own list; null for a linked one, which is a name only. */
  listId: string | null;
  kind: 'own' | 'linked';
  name: string;
  /** The kinds a linked list holds; empty for an own list. */
  kinds: ListedKind[];
  columns: ListColumn[];
  /** The rows still in play, in order. */
  rows: ListRowView[];
  /** The rows set aside, for the fold at the foot. */
  ruledOut: ListRowView[];
  /** The one line the chip carries after the count, or null when nothing stands out. */
  standout: string | null;
  /** The field a typed name goes in, for an own list's add box. */
  nameField: string | null;
};

/** What the chip shows, without the rows. */
export type ListChip = Pick<ListView, 'key' | 'name' | 'kind' | 'standout'> & {
  count: number;
  pictures: string[];
};

const RULED_OUT_WORDS = /^(ruled out|dropped|rejected|passed|not this one|no)$/i;
const PICKED_WORDS = /^(picked|chosen|the one|bought|yes)$/i;
const STATUS_WORDS = /status|decision|verdict|pick/i;

/** The field that names an own list's rows: a text field called name or title, else the first text field. */
export function nameFieldOf(fields: CollectionField[]): CollectionField | null {
  const text = liveFields(fields).filter((f) => f.type === 'text');
  return text.find((f) => /^(name|title)$/i.test(f.key) || /^(name|title)$/i.test(f.label)) ?? text[0] ?? null;
}

/** The choice field that says where a row stands, if the list has one. */
export function statusFieldOf(fields: CollectionField[]): CollectionField | null {
  return liveFields(fields).find((f) => f.type === 'choice' && (STATUS_WORDS.test(f.key) || STATUS_WORDS.test(f.label))) ?? null;
}

/** True when a status value says the row was picked: "Picked", "Chosen", "Bought". */
export function isPickedWord(value: unknown): boolean {
  return typeof value === 'string' && PICKED_WORDS.test(value.trim());
}

/** True when a status value says the row was set aside: "Ruled out", "Dropped". */
export function isRuledOutWord(value: unknown): boolean {
  return typeof value === 'string' && RULED_OUT_WORDS.test(value.trim());
}

/**
 * What picking one row of an own list writes (plan #2330.5): the row's status
 * set to the list's picked option, and every other live row not already ruled
 * out set to its ruled-out option. A list with no status field gains one
 * ("Status": Picked, Ruled out), and a status field lacking either option
 * gains it, so `fields` is what the list should hold afterwards and
 * `fieldsChanged` says whether that differs.
 */
export type PickPlan = {
  fields: CollectionField[];
  fieldsChanged: boolean;
  statusKey: string;
  picked: string;
  ruledOut: string;
  /** The other rows to mark ruled out, in the list's order. */
  others: string[];
};

export function pickPlan(
  fields: CollectionField[],
  rows: readonly Pick<CollectionRecord, 'id' | 'data'>[],
  rowId: string,
): PickPlan {
  let next = fields.map((f) => ({ ...f }));
  let status = statusFieldOf(next);
  let changed = false;
  if (!status) {
    const taken = new Set(next.map((f) => f.key));
    let key = 'status';
    for (let n = 2; taken.has(key); n++) key = `status_${n}`;
    status = { key, label: 'Status', type: 'choice', options: ['Picked', 'Ruled out'] };
    next = [...next, status];
    changed = true;
  }
  const options = status.options ?? [];
  let picked = options.find((o) => isPickedWord(o));
  let ruledOut = options.find((o) => isRuledOutWord(o));
  if (!picked || !ruledOut) {
    picked ??= 'Picked';
    ruledOut ??= 'Ruled out';
    const added = [picked, ruledOut].filter((o) => !options.includes(o));
    const key = status.key;
    next = next.map((f) => (f.key === key ? { ...f, options: [...options, ...added] } : f));
    changed = changed || added.length > 0;
  }
  const statusKey = status.key;
  const others = rows
    .filter((r) => r.id !== rowId && !isRuledOutWord(r.data[statusKey]))
    .map((r) => r.id);
  return { fields: next, fieldsChanged: changed, statusKey, picked, ruledOut, others };
}

/** The columns an own list shows: every live field but its name, its picture and its link, at most five. */
function ownColumns(fields: CollectionField[], name: CollectionField | null): CollectionField[] {
  return liveFields(fields)
    .filter((f) => f !== name && f.type !== 'image' && f.type !== 'link' && f.type !== 'long_text' && f.type !== 'ref')
    .slice(0, 5);
}

const NUMERIC = new Set(['number', 'money', 'percent', 'day_of_month']);

function firstOf(fields: CollectionField[], type: CollectionField['type'], data: Record<string, FieldValue>): string | null {
  for (const field of liveFields(fields)) {
    if (field.type !== type) continue;
    const value = data[field.key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function ownRow(fields: CollectionField[], record: CollectionRecord, columns: CollectionField[]): ListRowView {
  const name = nameFieldOf(fields);
  const status = statusFieldOf(fields);
  const said = status ? displayValue(status, record.data[status.key]) : '';
  const link = firstOf(fields, 'link', record.data) ?? (record.source === 'pasted' ? record.sourceRef : null);
  const title = name ? displayValue(name, record.data[name.key]).trim() : '';
  return {
    id: record.id,
    title: title || (link ? hostOf(link) : 'Untitled row'),
    href: link,
    external: link !== null,
    picture: firstOf(fields, 'image', record.data),
    cells: Object.fromEntries(columns.map((f) => [f.key, displayValue(f, record.data[f.key]) || null])),
    draft: record.draft,
    gone: false,
    ruledOut: RULED_OUT_WORDS.test(said.trim()),
    picked: PICKED_WORDS.test(said.trim()),
    comments: 0,
  };
}

/** A web address's host, for a row with nothing else to be called by. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The columns each kind of linked row fills. */
const LINKED_COLUMNS: Record<ListedKind, ListColumn[]> = {
  reading: [{ key: 'status', label: 'Status' }],
  event: [
    { key: 'when', label: 'When' },
    { key: 'where', label: 'Where' },
  ],
  saved_item: [
    { key: 'price', label: 'Price', num: true },
    { key: 'status', label: 'Status' },
  ],
  contact: [
    { key: 'role', label: 'Role' },
    { key: 'company', label: 'Company' },
  ],
};

const READING_WORDS: Record<string, string> = {
  queued: 'Not started',
  reading: 'Reading',
  read: 'Read',
  abandoned: 'Put down',
};

const SAVED_WORDS: Record<string, string> = {
  saved: 'Saved',
  purchased: 'Bought',
  dismissed: 'Dismissed',
};

/** The day an event starts on, as YYYY-MM-DD in the person's zone. */
function eventDay(row: Extract<LinkedRow, { kind: 'event' }>, timeZone: string): string | null {
  if (row.startsOn) return row.startsOn;
  if (!row.startsAt) return null;
  return zoneDay(row.startsAt, timeZone);
}

function linkedTitle(row: LinkedRow): string | null {
  return row.kind === 'contact' ? row.name : row.title;
}

/** What a row that has left its workspace is called, since its name went with it. */
const GONE_TITLE: Record<ListedKind, string> = {
  reading: 'A reading',
  event: 'An event',
  saved_item: 'A saved product',
  contact: 'A contact',
};

function linkedRow(row: LinkedRow, timeZone: string, comments: number): ListRowView {
  const base = {
    id: row.linkId,
    title: row.gone ? GONE_TITLE[row.kind] : linkedTitle(row)?.trim() || 'Untitled',
    href: row.href,
    external: false,
    picture: null as string | null,
    draft: false,
    gone: row.gone,
    ruledOut: false,
    picked: false,
    comments,
  };
  if (row.gone) return { ...base, cells: {} };
  switch (row.kind) {
    case 'reading':
      return {
        ...base,
        cells: { status: row.status ? (READING_WORDS[row.status] ?? row.status) : null },
        ruledOut: row.status === 'abandoned',
        picked: row.status === 'read',
      };
    case 'event': {
      const day = eventDay(row, timeZone);
      return {
        ...base,
        cells: {
          when: day ? whenDate(day, { timeZone: 'UTC', weekday: 'short', year: 'auto' }) : null,
          where: row.location,
        },
      };
    }
    case 'saved_item':
      return {
        ...base,
        picture: row.imageUrl,
        cells: {
          price: row.priceCents === null ? null : formatMoney(row.priceCents, (row.currency ?? 'USD') as CurrencyCode),
          status: row.bought ? 'Bought' : row.status ? (SAVED_WORDS[row.status] ?? row.status) : null,
        },
        ruledOut: row.status === 'dismissed',
        picked: row.bought || row.status === 'purchased',
      };
    case 'contact':
      return { ...base, cells: { role: row.role, company: row.company } };
  }
}

/** An address-safe form of a name: "Pantry options" is "pantry-options". */
export function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'list';
}

/** The words a chip has room for: the first few of a long name, "HOMCOM 72" of a whole listing title. */
export function shortName(title: string, room = 12): string {
  const words = title.split(/\s+/).filter(Boolean);
  let out = words[0] ?? title;
  for (const word of words.slice(1)) {
    if (`${out} ${word}`.length > room) break;
    out = `${out} ${word}`;
  }
  return out.length > room + 6 ? `${out.slice(0, room)}…` : out;
}

/** How many of a kind of row, said: "1 read", "2 to confirm". */
function counted(n: number, what: string): string {
  return `${n} ${what}`;
}

/**
 * The one thing the chip says after the count: what needs the person first,
 * then what was picked, then what is next. Null when nothing stands out, and
 * the chip then shows the count alone.
 */
export function standoutOf(view: Pick<ListView, 'kind' | 'kinds' | 'rows'>, rowsByKind: LinkedRow[] = [], today?: string, timeZone = 'UTC'): string | null {
  const drafts = view.rows.filter((r) => r.draft).length;
  if (drafts > 0) return counted(drafts, 'to confirm');
  const picked = view.rows.filter((r) => r.picked);
  if (view.kind === 'own') {
    if (picked.length === 1) return `${shortName(picked[0].title)} picked`;
    if (picked.length > 1) return counted(picked.length, 'picked');
    return null;
  }
  const gone = view.rows.filter((r) => r.gone).length;
  const only = view.kinds.length === 1 ? view.kinds[0] : null;
  if (only === 'reading') {
    if (picked.length > 0) return counted(picked.length, 'read');
    const reading = rowsByKind.filter((r) => r.kind === 'reading' && r.status === 'reading').length;
    if (reading > 0) return counted(reading, 'being read');
  }
  if (only === 'saved_item' && picked.length > 0) {
    return picked.length === 1 ? `${shortName(picked[0].title)} bought` : counted(picked.length, 'bought');
  }
  if (only === 'event' && today) {
    const next = rowsByKind
      .filter((r): r is Extract<LinkedRow, { kind: 'event' }> => r.kind === 'event' && !r.gone)
      .map((r) => eventDay(r, timeZone))
      .filter((day): day is string => day !== null && day >= today)
      .sort()[0];
    if (next) return `next ${whenDate(next, { timeZone: 'UTC', weekday: 'short', year: 'auto' })}`;
  }
  if (gone > 0) return counted(gone, 'no longer there');
  return null;
}

/** One of a goal's own lists, as the page draws it. */
export function ownListView(list: GoalList): Omit<ListView, 'key'> {
  const name = nameFieldOf(list.fields);
  const columns = ownColumns(list.fields, name);
  const all = list.rows.map((record) => ownRow(list.fields, record, columns));
  const view = {
    listId: list.id,
    kind: 'own' as const,
    name: list.name,
    kinds: [],
    columns: columns.map((f) => ({ key: f.key, label: f.label, num: NUMERIC.has(f.type) })),
    rows: all.filter((r) => !r.ruledOut),
    ruledOut: all.filter((r) => r.ruledOut),
    nameField: name?.key ?? null,
  };
  return { ...view, standout: standoutOf(view) };
}

/** One list of linked rows, as the page draws it. `comments` is each linked row's count, by link id. */
export function linkedListView(
  list: LinkedList,
  options: { today?: string; timeZone?: string; comments?: ReadonlyMap<string, number> } = {},
): Omit<ListView, 'key'> {
  const timeZone = options.timeZone ?? 'UTC';
  const seen = new Set<string>();
  const columns = list.kinds
    .flatMap((kind) => LINKED_COLUMNS[kind])
    .filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
  const all = list.rows.map((row) => linkedRow(row, timeZone, options.comments?.get(row.linkId) ?? 0));
  const view = {
    listId: null,
    kind: 'linked' as const,
    name: list.name,
    kinds: list.kinds,
    columns,
    rows: all.filter((r) => !r.ruledOut),
    ruledOut: all.filter((r) => r.ruledOut),
    nameField: null,
  };
  return { ...view, standout: standoutOf(view, list.rows, options.today, timeZone) };
}

/**
 * A goal's lists in the order the page shows them, its own first in their
 * order and then the linked ones as they were first linked, each with a key
 * no other list on the goal has.
 */
export function goalListViews(
  own: readonly GoalList[],
  linked: readonly LinkedList[],
  options: { today?: string; timeZone?: string; comments?: ReadonlyMap<string, number> } = {},
): ListView[] {
  const taken = new Set<string>();
  const keyed = (view: Omit<ListView, 'key'>): ListView => {
    const base = slugOf(view.name);
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    taken.add(key);
    return { ...view, key };
  };
  return [...own.map((list) => keyed(ownListView(list))), ...linked.map((list) => keyed(linkedListView(list, options)))];
}

/** What a list's chip shows: the count of rows in play, the line, and up to three pictures. */
export function chipOf(view: ListView): ListChip {
  return {
    key: view.key,
    name: view.name,
    kind: view.kind,
    standout: view.standout,
    count: view.rows.length,
    pictures: view.rows.flatMap((r) => (r.picture ? [r.picture] : [])).slice(0, 3),
  };
}

/** The chip's words after the name: "2 · HOMCOM 72 inch picked", or the count alone. */
export function chipLine(chip: Pick<ListChip, 'count' | 'standout'>): string {
  if (chip.standout) return `${chip.count} · ${chip.standout}`;
  // An empty list's chip is its name alone; "0" says nothing the panel will not.
  return chip.count > 0 ? String(chip.count) : '';
}

/** A list's tab id. */
export function listTabId(key: string): string {
  return `${LIST_TAB_PREFIX}${key}`;
}

type TabLike = { id: string; label: string; count?: number };

/**
 * The goal page's tabs with a tab for each list after Steps, once the goal
 * has LIST_TABS_FROM lists or more. With fewer, the tabs are as they were and
 * the chips alone open the lists.
 */
export function tabsWithLists<T extends TabLike>(tabs: readonly T[], lists: readonly ListView[]): TabLike[] {
  if (lists.length < LIST_TABS_FROM) return [...tabs];
  const at = tabs.findIndex((t) => t.id === 'steps');
  const listTabs = lists.map((list) => ({ id: listTabId(list.key), label: list.name, count: list.rows.length }));
  return [...tabs.slice(0, at + 1), ...listTabs, ...tabs.slice(at + 1)];
}

/** The list a tab id opens, or null for any other tab. */
export function listForTab(tab: string, lists: readonly ListView[]): ListView | null {
  if (!tab.startsWith(LIST_TAB_PREFIX) || lists.length < LIST_TABS_FROM) return null;
  return lists.find((list) => listTabId(list.key) === tab) ?? null;
}

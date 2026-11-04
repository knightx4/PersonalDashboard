/**
 * The rules of a group chat in Messages (plan #2879.1.1), kept pure so the
 * tests and the screens share them. A group is one you.advisor_chats row of
 * kind group, with its bots in you.advisor_chat_members (you 0042).
 */

/** The fewest bots a group holds: one bot is a direct chat. */
export const GROUP_MIN = 2;
/** The most bots a group holds at once; the database refuses a ninth. */
export const GROUP_MAX = 8;
/** A group name's longest, as you.advisor_chats.title allows. */
export const GROUP_TITLE_MAX = 200;

export const REACTIONS = ['heart', 'thumbs_up', 'thumbs_down', 'laugh', 'emphasis', 'question'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** How each reaction is drawn on a bubble. */
export const REACTION_GLYPH: Record<Reaction, string> = {
  heart: '❤️',
  thumbs_up: '👍',
  thumbs_down: '👎',
  laugh: '😂',
  emphasis: '‼️',
  question: '❓',
};

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && (REACTIONS as readonly string[]).includes(value);
}

export type GroupMember = {
  id: string;
  key: string;
  name: string;
  colour: string;
  /** While now is before this, the bot is typing in the group. */
  typingUntil: string | null;
};

const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.', 'sir', 'dame']);

/**
 * What to call someone in a group, for the default title and for addressing:
 * a seat keeps its whole name ("The CFO"), a title is skipped ("Dr Ada
 * Smith" is "Ada"), and anyone else goes by their first word.
 */
export function firstName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words[0].toLowerCase() === 'the') return words.join(' ');
  if (words.length > 1 && HONORIFICS.has(words[0].toLowerCase())) return words[1];
  return words[0];
}

/** What a group with no name is called: its members' first names, three at most and a count of the rest. */
export function defaultGroupTitle(names: readonly string[]): string {
  const firsts = names.map(firstName).filter(Boolean);
  if (firsts.length === 0) return 'Group';
  if (firsts.length === 1) return firsts[0];
  if (firsts.length <= 3) return `${firsts.slice(0, -1).join(', ')} and ${firsts[firsts.length - 1]}`;
  return `${firsts.slice(0, 3).join(', ')} and ${firsts.length - 3} more`;
}

/** A group's title as the person sees it: the name they gave it, or the default. */
export function groupTitleOf(title: string | null, names: readonly string[]): string {
  return title?.trim() || defaultGroupTitle(names);
}

/** A typed name, trimmed; null for an empty one, which keeps the default. */
export function cleanGroupTitle(text: string | null | undefined): { ok: true; title: string | null } | { ok: false; error: string } {
  const trimmed = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { ok: true, title: null };
  if (trimmed.length > GROUP_TITLE_MAX) return { ok: false, error: `Keep the name to ${GROUP_TITLE_MAX} characters.` };
  return { ok: true, title: trimmed };
}

/**
 * The bots picked for a group, each once, in the order picked; an error
 * when there are fewer than two or more than eight.
 */
export function cleanMemberKeys(keys: readonly string[]): { ok: true; keys: string[] } | { ok: false; error: string } {
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  if (unique.length < GROUP_MIN) return { ok: false, error: 'A group needs at least two bots.' };
  if (unique.length > GROUP_MAX) return { ok: false, error: `A group holds at most ${GROUP_MAX} bots.` };
  return { ok: true, keys: unique };
}

// ---------------------------------------------------------------------------
// Groups on the Messages tab (plan #2879.1.3).
// ---------------------------------------------------------------------------

/** A group in the Messages list. */
export type GroupRow = {
  kind: 'group';
  /** The chat's id, which its address and the send name. */
  id: string;
  title: string;
  /** The name the person gave it, or null for the members' first names. */
  name: string | null;
  members: GroupMember[];
  last: { text: string; role: 'person' | 'advisor'; speaker: string | null; at: string } | null;
  unread: boolean;
};

/** Where a group's thread is. */
export function groupHref(id: string): string {
  return `/chat/groups/${id}`;
}

/** A group's settings: rename, members, delete, in the thread's place. */
export function groupSettingsHref(id: string): string {
  return `/chat/groups/${id}?settings=1`;
}

/** The members typing now, by first name. */
export function typingNames(members: readonly GroupMember[], now: number): string[] {
  return members
    .filter((m) => {
      const until = m.typingUntil ? Date.parse(m.typingUntil) : NaN;
      return Number.isFinite(until) && until > now;
    })
    .map((m) => firstName(m.name));
}

/** "Ada", "Ada and Ben", "Ada, Ben and Cy" */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The line under a group's name: who is typing, the last thing said and by whom, or an invitation. */
export function groupPreviewOf(row: GroupRow, now: number): string {
  const typing = typingNames(row.members, now);
  if (typing.length === 1) return `${typing[0]} is typing…`;
  if (typing.length > 1) return `${namesList(typing)} are typing…`;
  if (!row.last) return 'Say hello to the group';
  if (row.last.role === 'person') return `You: ${row.last.text}`;
  return row.last.speaker ? `${firstName(row.last.speaker)}: ${row.last.text}` : row.last.text;
}

/** Who is in a group, as the quiet line under its name in the thread. */
export function groupDetailOf(members: readonly GroupMember[]): string {
  return namesList(members.map((m) => firstName(m.name))) || 'No one in this group yet';
}

/** One bot's reaction on a message. */
export type Reacted = { advisorId: string; reaction: Reaction };

/** Reactions on one message, one glyph each with who gave it. */
export function reactionSummary(list: readonly Reacted[], members: readonly GroupMember[]): { reaction: Reaction; glyph: string; who: string[] }[] {
  const nameOf = new Map(members.map((m) => [m.id, firstName(m.name)]));
  const out = new Map<Reaction, string[]>();
  for (const r of list) out.set(r.reaction, [...(out.get(r.reaction) ?? []), nameOf.get(r.advisorId) ?? 'Someone']);
  return REACTIONS.filter((r) => out.has(r)).map((reaction) => ({ reaction, glyph: REACTION_GLYPH[reaction], who: out.get(reaction) ?? [] }));
}

/** Who wrote a group's message: a member, one who left, or nobody known. */
export function speakerOf(speakerId: string | null, members: readonly GroupMember[], former: readonly GroupMember[]): GroupMember | null {
  if (!speakerId) return null;
  return members.find((m) => m.id === speakerId) ?? former.find((m) => m.id === speakerId) ?? null;
}

/** Which members a change of membership takes out and which it adds, by advisor id. */
export function memberChange(current: readonly string[], wanted: readonly string[]): { remove: string[]; add: string[] } {
  const now = new Set(current);
  const next = new Set(wanted);
  return { remove: current.filter((id) => !next.has(id)), add: wanted.filter((id) => !now.has(id)) };
}

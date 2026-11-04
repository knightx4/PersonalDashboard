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

/** A name's first word, for the default title and for addressing. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
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

/** Which members a change of membership takes out and which it adds, by advisor id. */
export function memberChange(current: readonly string[], wanted: readonly string[]): { remove: string[]; add: string[] } {
  const now = new Set(current);
  const next = new Set(wanted);
  return { remove: current.filter((id) => !next.has(id)), add: wanted.filter((id) => !now.has(id)) };
}

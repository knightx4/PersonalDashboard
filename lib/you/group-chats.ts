import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { listRoster, type RosterAdvisor } from '@/lib/you/board-advisors';
import { mentorColour } from '@/lib/you/chat-threads-model';
import { canTalkOf } from '@/lib/you/people-cards-model';
import { cleanGroupTitle, cleanMemberKeys, groupTitleOf, memberChange, type GroupMember } from '@/lib/you/group-chats-model';

export * from '@/lib/you/group-chats-model';

/**
 * Group chats in Messages (plan #2879.1.1): starting one, renaming it,
 * changing who is in it and deleting it. A group is a you.advisor_chats row
 * of kind group with a null advisor_id, and its bots are rows of
 * you.advisor_chat_members; a bot taken out is marked left rather than
 * deleted, so what it said keeps its name (you 0042).
 *
 * Every query names the person as well as relying on row level security.
 */

export type Group = {
  id: string;
  /** The name the person gave it, or null for the default. */
  name: string | null;
  /** What the screen calls it: the name, or the members' first names. */
  title: string;
  members: GroupMember[];
  /** Bots that were in the group and left, so their old messages keep a name. */
  former: GroupMember[];
  typingUntil: string | null;
  lastReadAt: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => str(value) || null;

/** The roster's bots for these keys, every one of them able to talk; an error naming the first that is not. */
async function botsFor(client: YouSupabaseClient, userId: string, keys: readonly string[]): Promise<Result<RosterAdvisor[]>> {
  const roster = await listRoster(client, userId);
  const byKey = new Map(roster.filter((a) => a.active).map((a) => [a.key, a]));
  const bots: RosterAdvisor[] = [];
  for (const key of keys) {
    const bot = byKey.get(key);
    if (!bot) return { ok: false, error: 'One of those bots is no longer in your Chat.' };
    if (!canTalkOf(bot)) return { ok: false, error: `${bot.name} is not ready to talk yet.` };
    bots.push(bot);
  }
  return { ok: true, value: bots };
}

/** Start a group of two to eight bots, by key, with an optional name. */
export async function createGroup(
  client: YouSupabaseClient,
  userId: string,
  input: { keys: readonly string[]; title?: string | null },
): Promise<Result<{ chatId: string }>> {
  const keys = cleanMemberKeys(input.keys);
  if (!keys.ok) return keys;
  const title = cleanGroupTitle(input.title);
  if (!title.ok) return title;
  const bots = await botsFor(client, userId, keys.keys);
  if (!bots.ok) return bots;

  const made = await client
    .from('advisor_chats')
    .insert({ user_id: userId, kind: 'group', advisor_id: null, title: title.title })
    .select('id')
    .single();
  if (made.error || typeof made.data?.id !== 'string') {
    throw new Error(`Starting the group failed: ${made.error?.message ?? 'no row came back'}`);
  }
  const chatId = made.data.id;
  const members = await client
    .from('advisor_chat_members')
    .insert(bots.value.map((b) => ({ user_id: userId, chat_id: chatId, advisor_id: b.id })));
  if (members.error) {
    await client.from('advisor_chats').delete().eq('user_id', userId).eq('id', chatId);
    throw new Error(`Adding the bots to the group failed: ${members.error.message}`);
  }
  return { ok: true, value: { chatId } };
}

/** Rename a group; an empty name goes back to the members' first names. */
export async function renameGroup(client: YouSupabaseClient, userId: string, chatId: string, text: string): Promise<Result<null>> {
  const title = cleanGroupTitle(text);
  if (!title.ok) return title;
  const { data, error } = await client
    .from('advisor_chats')
    .update({ title: title.title })
    .eq('user_id', userId)
    .eq('id', chatId)
    .eq('kind', 'group')
    .select('id');
  if (error) throw new Error(`Renaming the group failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return { ok: false, error: 'That group is not there any more.' };
  return { ok: true, value: null };
}

/**
 * Make the group's members exactly these bots, still two to eight. Those
 * taken out are marked left; those added join now, a bot that left before
 * coming back on its old row.
 */
export async function setGroupMembers(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  wantedKeys: readonly string[],
  now: number = Date.now(),
): Promise<Result<null>> {
  const keys = cleanMemberKeys(wantedKeys);
  if (!keys.ok) return keys;
  const group = await loadGroup(client, userId, chatId);
  if (!group) return { ok: false, error: 'That group is not there any more.' };
  // A bot already in the group may stay even if it has since stopped being ready to talk.
  const staying = new Map(group.members.map((m) => [m.key, m.id]));
  const newKeys = keys.keys.filter((k) => !staying.has(k));
  const bots = await botsFor(client, userId, newKeys);
  if (!bots.ok) return bots;
  const idOf = new Map([...staying, ...bots.value.map((b) => [b.key, b.id] as const)]);
  const wanted = keys.keys.map((k) => idOf.get(k)).filter((id): id is string => Boolean(id));
  const change = memberChange(
    group.members.map((m) => m.id),
    wanted,
  );
  const at = new Date(now).toISOString();
  if (change.remove.length > 0) {
    const { error } = await client
      .from('advisor_chat_members')
      .update({ left_at: at, typing_until: null })
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .in('advisor_id', change.remove);
    if (error) throw new Error(`Taking bots out of the group failed: ${error.message}`);
  }
  if (change.add.length > 0) {
    const { error } = await client
      .from('advisor_chat_members')
      .upsert(
        change.add.map((advisorId) => ({ user_id: userId, chat_id: chatId, advisor_id: advisorId, joined_at: at, left_at: null, typing_until: null })),
        { onConflict: 'chat_id,advisor_id' },
      );
    if (error) throw new Error(`Adding bots to the group failed: ${error.message}`);
  }
  return { ok: true, value: null };
}

/** Delete a group with everything said in it. */
export async function deleteGroup(client: YouSupabaseClient, userId: string, chatId: string): Promise<boolean> {
  const { data, error } = await client
    .from('advisor_chats')
    .delete()
    .eq('user_id', userId)
    .eq('id', chatId)
    .eq('kind', 'group')
    .select('id');
  if (error) throw new Error(`Deleting the group failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** One group with its members, or null when the id names no group of theirs. */
export async function loadGroup(client: YouSupabaseClient, userId: string, chatId: string): Promise<Group | null> {
  const chat = await client
    .from('advisor_chats')
    .select('id, title, typing_until, last_read_at')
    .eq('user_id', userId)
    .eq('id', chatId)
    .eq('kind', 'group')
    .maybeSingle();
  if (chat.error) throw new Error(`Reading the group failed: ${chat.error.message}`);
  const row = chat.data as Record<string, unknown> | null;
  if (!row || typeof row.id !== 'string') return null;
  const groups = await loadMembersOf(client, userId, [row.id]);
  const { members, former } = groups.get(row.id) ?? { members: [], former: [] };
  const name = strOrNull(row.title);
  return {
    id: row.id,
    name,
    title: groupTitleOf(name, members.map((m) => m.name)),
    members,
    former,
    typingUntil: strOrNull(row.typing_until),
    lastReadAt: strOrNull(row.last_read_at),
  };
}

/** The members of each of these groups, in the order they joined, and those who left. */
export async function loadMembersOf(
  client: YouSupabaseClient,
  userId: string,
  chatIds: readonly string[],
): Promise<Map<string, { members: GroupMember[]; former: GroupMember[] }>> {
  const out = new Map<string, { members: GroupMember[]; former: GroupMember[] }>();
  if (chatIds.length === 0) return out;
  const [rows, bots] = await Promise.all([
    client
      .from('advisor_chat_members')
      .select('chat_id, advisor_id, joined_at, left_at, typing_until')
      .eq('user_id', userId)
      .in('chat_id', [...chatIds])
      .order('joined_at', { ascending: true }),
    client.from('board_advisors').select('id, key, name, colour').eq('user_id', userId),
  ]);
  if (rows.error) throw new Error(`Reading the group's bots failed: ${rows.error.message}`);
  if (bots.error) throw new Error(`Reading the group's bots failed: ${bots.error.message}`);
  const botOf = new Map(((bots.data ?? []) as Record<string, unknown>[]).map((b) => [str(b.id), b]));
  for (const id of chatIds) out.set(id, { members: [], former: [] });
  for (const r of (rows.data ?? []) as Record<string, unknown>[]) {
    const bot = botOf.get(str(r.advisor_id));
    const entry = out.get(str(r.chat_id));
    if (!bot || !entry) continue;
    const key = str(bot.key);
    const member: GroupMember = {
      id: str(bot.id),
      key,
      name: str(bot.name),
      colour: mentorColour(key, strOrNull(bot.colour)),
      typingUntil: strOrNull(r.typing_until),
    };
    (r.left_at ? entry.former : entry.members).push(member);
  }
  return out;
}

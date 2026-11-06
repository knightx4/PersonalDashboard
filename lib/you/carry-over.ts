import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  CARRY_READ,
  carriedLines,
  carryOverText,
  type CarryChat,
  type CarryEpisode,
  type CarryMessage,
} from '@/lib/you/carry-over-model';

export * from '@/lib/you/carry-over-model';

/**
 * The reads behind what a bot carries in from its other chats (plan #2983);
 * the rules are in carry-over-model.ts. Every read names the person, so the
 * same function serves a service-role client and the person's own. Bounded
 * by CARRY_READ messages per bot, never by how long its threads are.
 */

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const rows = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);

function check<T extends { error: { message: string } | null }>(what: string, r: T): T {
  if (r.error) throw new Error(`Reading ${what} failed: ${r.error.message}`);
  return r;
}

/**
 * For each bot, its carried messages as one block of context, keyed by the
 * bot's id; a bot with nothing to carry is left out. Throws when a read
 * fails, so the caller can reply without it.
 */
export async function loadCarryOver(
  client: YouSupabaseClient,
  userId: string,
  advisorIds: readonly string[],
  chatId: string,
  options: { where: 'direct' | 'group'; now: Date; timeZone: string },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(advisorIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const [direct, memberships] = await Promise.all([
    client.from('advisor_chats').select('id, advisor_id').eq('user_id', userId).eq('kind', 'direct').in('advisor_id', ids),
    client.from('advisor_chat_members').select('chat_id, advisor_id, joined_at, left_at').eq('user_id', userId).in('advisor_id', ids),
  ]);
  check('the one-on-ones', direct);
  check('the groups', memberships);

  const groupIds = [...new Set(rows(memberships.data).map((r) => str(r.chat_id)).filter((id) => id && id !== chatId))];
  const [groups, everyone] = groupIds.length
    ? await Promise.all([
        client.from('advisor_chats').select('id, title').eq('user_id', userId).in('id', groupIds),
        client.from('advisor_chat_members').select('chat_id, advisor_id, left_at').eq('user_id', userId).in('chat_id', groupIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  check('the group names', groups);
  check('the group members', everyone);

  const chatsBy = new Map<string, CarryChat[]>(ids.map((id) => [id, []]));
  for (const r of rows(direct.data)) {
    const id = str(r.id);
    if (id && id !== chatId) chatsBy.get(str(r.advisor_id))?.push({ id, kind: 'direct' });
  }
  const titleOf = new Map(rows(groups.data).map((r) => [str(r.id), str(r.title) || null] as const));
  const membersOf = new Map<string, string[]>();
  for (const r of rows(everyone.data)) {
    if (r.left_at) continue;
    const list = membersOf.get(str(r.chat_id)) ?? [];
    list.push(str(r.advisor_id));
    membersOf.set(str(r.chat_id), list);
  }
  const memberIds = [...new Set([...membersOf.values()].flat())];

  for (const r of rows(memberships.data)) {
    const id = str(r.chat_id);
    if (!id || id === chatId || !titleOf.has(id)) continue;
    chatsBy.get(str(r.advisor_id))?.push({
      id,
      kind: 'group',
      title: titleOf.get(id) ?? null,
      memberNames: [],
      joinedAt: str(r.joined_at),
      leftAt: str(r.left_at) || null,
    });
  }

  const allChatIds = [...new Set([...chatsBy.values()].flat().map((c) => c.id))];
  if (allChatIds.length === 0) return out;

  // Each bot's newest messages, read apart so one busy bot cannot crowd out another's.
  const reads = await Promise.all(
    ids.map(async (advisorId) => {
      const chatIds = (chatsBy.get(advisorId) ?? []).map((c) => c.id);
      if (chatIds.length === 0) return [advisorId, [] as CarryMessage[]] as const;
      const r = check(
        'the other chats',
        await client
          .from('advisor_messages')
          .select('id, chat_id, role, speaker_id, text, created_at')
          .eq('user_id', userId)
          .in('chat_id', chatIds)
          .order('created_at', { ascending: false })
          .limit(CARRY_READ),
      );
      const messages: CarryMessage[] = rows(r.data).flatMap((m) =>
        typeof m.id === 'string' && str(m.text)
          ? [
              {
                id: m.id,
                chatId: str(m.chat_id),
                role: m.role === 'advisor' ? ('advisor' as const) : ('person' as const),
                speakerId: str(m.speaker_id) || null,
                text: str(m.text),
                createdAt: str(m.created_at),
              },
            ]
          : [],
      );
      return [advisorId, messages] as const;
    }),
  );
  const read = new Map(reads);
  const all = [...read.values()].flat();
  if (all.length === 0) return out;

  const oldest = all.reduce((min, m) => (m.createdAt < min ? m.createdAt : min), all[0].createdAt);
  const speakerIds = [...new Set(all.map((m) => m.speakerId).filter((id): id is string => !!id))];
  const nameIds = [...new Set([...speakerIds, ...memberIds])];
  const [episodes, names] = await Promise.all([
    client
      .from('advisor_episodes')
      .select('chat_id, started_at, ended_at, summarised_at')
      .eq('user_id', userId)
      .in('chat_id', allChatIds)
      .not('summary', 'is', null)
      .gte('ended_at', oldest)
      .limit(CARRY_READ * ids.length),
    nameIds.length
      ? client.from('board_advisors').select('id, name').eq('user_id', userId).in('id', nameIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  check('earlier conversations', episodes);
  check('the bots', names);

  const nameOf = new Map(rows(names.data).map((r) => [str(r.id), str(r.name)] as const));
  const summaries: CarryEpisode[] = rows(episodes.data).map((e) => ({
    chatId: str(e.chat_id),
    startedAt: str(e.started_at),
    endedAt: str(e.ended_at),
    summarisedAt: str(e.summarised_at) || null,
  }));

  for (const advisorId of ids) {
    const chats = (chatsBy.get(advisorId) ?? []).map((c) =>
      c.kind === 'group' ? { ...c, memberNames: (membersOf.get(c.id) ?? []).map((id) => nameOf.get(id) ?? '').filter(Boolean) } : c,
    );
    const lines = carriedLines({ advisorId, chatId, chats, messages: read.get(advisorId) ?? [], episodes: summaries, names: nameOf });
    const text = carryOverText(lines, options.where, options);
    if (text) out.set(advisorId, text);
  }
  return out;
}

import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { listRoster, type RosterAdvisor } from '@/lib/you/board-advisors';
import { readBrain, type Brain } from '@/lib/you/board-brain';
import {
  ADVICE_GAP_MS,
  ADVICE_STALE_AFTER_MS,
  chatOf,
  COUNCIL_SKILL_PATH,
  cleanMessage,
  memoryOf,
  messageOf,
  newestByAdvisor,
  EPISODE_QUIET_MS,
  episodeDue,
  NO_ROUTINE_ERROR,
  NOTE_COLUMNS,
  noteOf,
  NOTES_PER_DAY,
  replyState,
  REPLY_STALE_AFTER_MS,
  unreadNotes,
  UNREAD_MAX,
  watchOf,
  type CouncilChat,
  type CouncilMemory,
  type CouncilMessage,
  type CouncilNote,
  type Mentor,
  type MentorWatch,
  type Reaction,
} from '@/lib/you/council-model';
import { unreadTextsOf, type TextRow, type TextThread } from '@/lib/you/council-texts';
import { canTalkOf } from '@/lib/you/people-cards-model';
import { dueBriefLines, loadReachOutDue, readRulePeople, type DuePerson, type SchemaReader } from '@/lib/you/reach-out-due';

export * from '@/lib/you/council-model';

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => str(value) || null;

/**
 * The Council (you 0037): the board's sixteen advisors as mentors the person
 * reads and talks to, alongside the decisions the board still works.
 *
 * Three things happen here.
 *
 *   - Texts. Once a day the board routine runs a round in which a few
 *     mentors each text the person, unasked, in their thread, about
 *     something of theirs (.claude/skills/board/council.md; plan #2748.7).
 *     Texts may not pile up while the person is away: a mentor with an
 *     unread text writes nothing more, nothing is written while six are
 *     unread, at most three are written a day, and none between 22:00 and
 *     08:00 their time. you.advisor_texts_cap (you 0039) holds the same
 *     rules; `decideAdviceRun` skips the round before it is fired when they
 *     would refuse every text. The notes written before #2748.7 stay in
 *     you.council_notes and are still shown on each mentor's tile and page.
 *   - Talks. One running conversation per mentor (you.advisor_chats). The
 *     person's message is saved, the chat marked waiting, and the board
 *     routine fired to write the mentor's reply on the person's plan, so a
 *     reply takes a few minutes and costs no API spend.
 *   - Memory. What a mentor keeps between talks (you.advisor_memory), and
 *     the commitments the person made to one, which that mentor follows up.
 *     Each daily round first summarises the conversations that ended
 *     (you.advisor_episodes) and updates the mentors' memory from them, so
 *     it is started whenever one is due, even with the note caps full.
 *
 * Every query names the person as well as relying on row level security, so
 * the same functions serve a service-role client. Rows written by a session
 * are read defensively: an entry of the wrong shape is dropped.
 */

function mentorOf(advisor: RosterAdvisor, note: CouncilNote | null, chat: CouncilChat | null, now: number): Mentor {
  return {
    id: advisor.id,
    key: advisor.key,
    name: advisor.name,
    kind: advisor.kind,
    question: advisor.question,
    focus: advisor.focus,
    active: advisor.active,
    canTalk: canTalkOf(advisor),
    note,
    waiting: replyState(chat, now).kind === 'waiting',
  };
}


export type CouncilHome = {
  mentors: Mentor[];
  unread: CouncilNote[];
  /** Mentors' texts the person has not read (plan #2748.7). */
  unreadTexts: number;
  /** The newest advice round, for when the next comes and whether it failed. */
  lastRound: { status: string; requestedAt: string; error: string | null } | null;
};

/** Everything the Council's home draws: every mentor on the council, their newest note and the unread ones. */
export async function loadCouncilHome(client: YouSupabaseClient, userId: string, now: number): Promise<CouncilHome> {
  const [roster, notes, chats, round, texts] = await Promise.all([
    listRoster(client, userId),
    client.from('council_notes').select(NOTE_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(300),
    client
      .from('advisor_chats')
      .select('id, advisor_id, reply_status, reply_requested_at, reply_error, last_message_at')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false, nullsFirst: false }),
    client
      .from('council_runs')
      .select('status, requested_at, error')
      .eq('user_id', userId)
      .eq('kind', 'advice')
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    readUnreadTexts(client, userId),
  ]);
  for (const r of [notes, chats, round]) {
    if (r.error) throw new Error(`Reading your council failed: ${r.error.message}`);
  }
  const allNotes = (notes.data ?? []).flatMap((row) => {
    const n = noteOf(row as Record<string, unknown>);
    return n ? [n] : [];
  });
  const newest = newestByAdvisor(allNotes);
  const chatByAdvisor = new Map<string, CouncilChat>();
  for (const row of (chats.data ?? []) as Record<string, unknown>[]) {
    const chat = chatOf(row);
    const advisorId = str(row.advisor_id);
    if (chat && advisorId && !chatByAdvisor.has(advisorId)) chatByAdvisor.set(advisorId, chat);
  }
  const mentors = roster
    .filter((a) => a.active)
    .map((a) => mentorOf(a, newest.get(a.id) ?? null, chatByAdvisor.get(a.id) ?? null, now));
  const onCouncil = new Set(mentors.map((m) => m.id));
  const roundRow = round.data as Record<string, unknown> | null;
  return {
    mentors,
    unread: unreadNotes(allNotes).filter((n) => onCouncil.has(n.advisorId)),
    unreadTexts: texts.length,
    lastRound: roundRow
      ? { status: str(roundRow.status), requestedAt: str(roundRow.requested_at), error: strOrNull(roundRow.error) }
      : null,
  };
}

export type MentorPage = {
  mentor: Mentor;
  brain: Brain | null;
  notes: CouncilNote[];
  chat: CouncilChat | null;
  messages: CouncilMessage[];
  memory: CouncilMemory[];
  /** Watches Dash wrote for this mentor that run, are paused or were stopped (plan #3030.1.4). */
  watches: MentorWatch[];
};

/** One mentor's page by key, or null when no such mentor is theirs. */
export async function loadMentorPage(
  client: YouSupabaseClient,
  userId: string,
  key: string,
  now: number,
): Promise<MentorPage | null> {
  const roster = await listRoster(client, userId);
  const advisor = roster.find((a) => a.key === key);
  if (!advisor) return null;

  const [brainRow, notes, chat, memory, watches] = await Promise.all([
    client.from('board_advisors').select('brain').eq('user_id', userId).eq('id', advisor.id).maybeSingle(),
    client
      .from('council_notes')
      .select(NOTE_COLUMNS)
      .eq('user_id', userId)
      .eq('advisor_id', advisor.id)
      .order('created_at', { ascending: false })
      .limit(30),
    client
      .from('advisor_chats')
      .select('id, reply_status, reply_requested_at, reply_error')
      .eq('user_id', userId)
      .eq('advisor_id', advisor.id)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('advisor_memory')
      .select('id, kind, text, due_on, done_at, created_at')
      .eq('user_id', userId)
      .eq('advisor_id', advisor.id)
      .is('retired_at', null)
      .order('created_at', { ascending: false })
      .limit(60),
    client
      .from('advisor_watches')
      .select('id, about, sends_when, every_days, status, last_run_at, last_error')
      .eq('user_id', userId)
      .eq('advisor_id', advisor.id)
      .in('status', ['active', 'paused', 'stopped'])
      .order('created_at', { ascending: false })
      .limit(40),
  ]);
  for (const r of [brainRow, notes, chat, memory, watches]) {
    if (r.error) throw new Error(`Reading ${advisor.name} failed: ${r.error.message}`);
  }
  const chatRow = chat.data ? chatOf(chat.data as Record<string, unknown>) : null;

  let messages: CouncilMessage[] = [];
  if (chatRow) {
    const { data, error } = await client
      .from('advisor_messages')
      .select('id, role, text, receipts, created_at, note_id')
      .eq('user_id', userId)
      .eq('chat_id', chatRow.id)
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) throw new Error(`Reading your talk with ${advisor.name} failed: ${error.message}`);
    messages = (data ?? [])
      .flatMap((row) => {
        const m = messageOf(row as Record<string, unknown>);
        return m ? [m] : [];
      })
      .reverse();
  }

  const noteList = (notes.data ?? []).flatMap((row) => {
    const n = noteOf(row as Record<string, unknown>);
    return n ? [n] : [];
  });
  return {
    mentor: mentorOf(advisor, noteList[0] ?? null, chatRow, now),
    brain: readBrain((brainRow.data as { brain?: unknown } | null)?.brain),
    notes: noteList,
    chat: chatRow,
    messages,
    memory: (memory.data ?? []).flatMap((row) => {
      const m = memoryOf(row as Record<string, unknown>);
      return m ? [m] : [];
    }),
    watches: (watches.data ?? []).flatMap((row) => {
      const w = watchOf(row as Record<string, unknown>);
      return w ? [w] : [];
    }),
  };
}

/** Stop a watch: it runs nothing from now on. Only a running or paused one of the person's own changes. */
export async function stopWatch(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  const { data, error } = await client
    .from('advisor_watches')
    .update({ status: 'stopped', decided_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .eq('id', id)
    .in('status', ['active', 'paused'])
    .select('id');
  if (error) throw new Error(`Stopping the watch failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error('That watch is not running.');
}

// ---------------------------------------------------------------------------
// Notes: read, reacted to, made a todo.
// ---------------------------------------------------------------------------

/** Mark notes read. Notes already read keep the time they were first read. */
export async function markNotesRead(
  client: YouSupabaseClient,
  userId: string,
  ids: readonly string[],
  now: number = Date.now(),
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await client
    .from('council_notes')
    .update({ read_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .in('id', ids)
    .is('read_at', null);
  if (error) throw new Error(`Marking the notes read failed: ${error.message}`);
}

/** Mark every unread note of one mentor read, as opening their page does. */
export async function markMentorRead(
  client: YouSupabaseClient,
  userId: string,
  advisorId: string,
  now: number = Date.now(),
): Promise<void> {
  const { error } = await client
    .from('council_notes')
    .update({ read_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .eq('advisor_id', advisorId)
    .is('read_at', null);
  if (error) throw new Error(`Marking the notes read failed: ${error.message}`);
}

/** Their reaction to a note, which also reads it. Null takes a reaction off. */
export async function reactToNote(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  reaction: Reaction | null,
  note: string | null,
  now: number = Date.now(),
): Promise<void> {
  const at = new Date(now).toISOString();
  const { error } = await client
    .from('council_notes')
    .update({
      reaction,
      reaction_note: reaction ? note?.trim() || null : null,
      reacted_at: reaction ? at : null,
    })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`Saving what you made of the note failed: ${error.message}`);
  await markNotesRead(client, userId, [id], now);
}

export async function loadNote(client: YouSupabaseClient, userId: string, id: string): Promise<CouncilNote | null> {
  const { data, error } = await client.from('council_notes').select(NOTE_COLUMNS).eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Reading the note failed: ${error.message}`);
  return data ? noteOf(data as Record<string, unknown>) : null;
}

export async function setNoteTask(client: YouSupabaseClient, userId: string, id: string, taskId: string): Promise<void> {
  const { error } = await client
    .from('council_notes')
    .update({ task_id: taskId, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`Linking the todo to the note failed: ${error.message}`);
}


// ---------------------------------------------------------------------------
// Memory: commitments done, things forgotten.
// ---------------------------------------------------------------------------

/** Mark a commitment done, or not done again. */
export async function setCommitmentDone(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  done: boolean,
  now: number = Date.now(),
): Promise<void> {
  const { error } = await client
    .from('advisor_memory')
    .update({ done_at: done ? new Date(now).toISOString() : null })
    .eq('user_id', userId)
    .eq('id', id)
    .eq('kind', 'commitment');
  if (error) throw new Error(`Saving the commitment failed: ${error.message}`);
}

/** Have a mentor forget something: it is kept, retired, and no longer read. */
export async function forgetMemory(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  const { error } = await client
    .from('advisor_memory')
    .update({ retired_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`Forgetting that failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Runs: the daily round and a mentor's reply.
// ---------------------------------------------------------------------------

/**
 * The daily round's brief. People due by their own reach-out rule (plan
 * #2931.5) follow the first three lines, each with the rows they may name.
 */
export function adviceBrief(input: { runId: string; userId: string; due?: readonly DuePerson[] }): string {
  return [
    `Follow ${COUNCIL_SKILL_PATH}`,
    `Council advice ${input.runId}`,
    `user_id ${input.userId}`,
    ...dueBriefLines(input.due ?? []),
  ].join('\n');
}

export function replyBrief(input: { runId: string; chatId: string; userId: string }): string {
  return [
    `Follow ${COUNCIL_SKILL_PATH}`,
    `Council reply ${input.runId}`,
    `chat ${input.chatId}`,
    `user_id ${input.userId}`,
  ].join('\n');
}

type RunStart =
  | { started: true; runId: string }
  | { started: false; reason: 'running' | 'no_routine' | 'error'; error: string };

async function queueAndFire(input: {
  client: YouSupabaseClient;
  userId: string;
  kind: 'advice' | 'reply';
  chatId?: string;
  routine: RoutineTarget;
  brief: (runId: string) => string;
  staleAfterMs: number;
  now: number;
  fetch?: typeof globalThis.fetch;
}): Promise<RunStart> {
  const { client, userId, kind, routine, now } = input;
  if (!routine.id || !routine.token) return { started: false, reason: 'no_routine', error: NO_ROUTINE_ERROR };

  let stale = client
    .from('council_runs')
    .update({ status: 'failed', error: 'The run stopped before it finished.', finished_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .eq('kind', kind)
    .in('status', ['queued', 'running'])
    .lt('requested_at', new Date(now - input.staleAfterMs).toISOString());
  if (input.chatId) stale = stale.eq('chat_id', input.chatId);
  await stale;

  const { data: row, error } = await client
    .from('council_runs')
    .insert({ user_id: userId, kind, chat_id: input.chatId ?? null, status: 'queued' })
    .select('id')
    .single();
  if (error?.code === '23505') return { started: false, reason: 'running', error: 'That is already being worked on.' };
  if (error || !row) return { started: false, reason: 'error', error: error?.message ?? 'Could not start the run.' };
  const runId = row.id as string;

  const fired = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: input.brief(runId),
    fetch: input.fetch,
  });
  if (!fired.ok) {
    await client
      .from('council_runs')
      .update({
        status: 'failed',
        error: `The board routine did not start. ${fired.error}`.slice(0, 2000),
        finished_at: new Date(now).toISOString(),
      })
      .eq('id', runId)
      .eq('user_id', userId);
    return { started: false, reason: 'error', error: fired.error };
  }
  const body = fired.body as Record<string, unknown> | null;
  const runUrl = typeof body?.claude_code_session_url === 'string' ? body.claude_code_session_url : null;
  if (runUrl) {
    await client.from('council_runs').update({ run_url: runUrl.slice(0, 500) }).eq('id', runId).eq('user_id', userId);
  }
  return { started: true, runId };
}

/**
 * The mentors' texts the person has not read, each with its mentor (plan
 * #2748.7): read_at null and newer than the thread's last_read_at, as
 * you.advisor_texts_cap counts them.
 */
export async function readUnreadTexts(
  client: YouSupabaseClient,
  userId: string,
): Promise<{ advisorId: string; createdAt: string }[]> {
  const [threads, texts] = await Promise.all([
    client.from('advisor_chats').select('id, advisor_id, last_read_at').eq('user_id', userId),
    client
      .from('advisor_messages')
      .select('chat_id, created_at, read_at')
      .eq('user_id', userId)
      .eq('kind', 'text_first')
      // The Council's own: a rule's texts (plan #2854.1) keep their own limit.
      .is('text_rule', null)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  for (const r of [threads, texts]) {
    if (r.error) throw new Error(`Reading your mentors' texts failed: ${r.error.message}`);
  }
  const threadRows: TextThread[] = ((threads.data ?? []) as Record<string, unknown>[]).map((t) => ({
    id: str(t.id),
    advisorId: str(t.advisor_id),
    lastReadAt: strOrNull(t.last_read_at),
  }));
  const textRows: TextRow[] = ((texts.data ?? []) as Record<string, unknown>[]).map((m) => ({
    chatId: str(m.chat_id),
    createdAt: str(m.created_at),
    readAt: strOrNull(m.read_at),
  }));
  return unreadTextsOf(threadRows, textRows);
}

export type AdviceDecision = { start: true } | { start: false; skipped: string };

/**
 * Whether the daily round should run. Pure, so the tests fix the clock.
 *
 *   - Never two at once: an open round not yet stale skips.
 *   - Once a day: a round asked for in the last twenty hours skips, so a
 *     round that keeps failing is tried daily, not every tick.
 *   - Never at night: in the person's quiet hours (22:00 to 08:00 their
 *     time) nothing starts, memory included; the five-minute council-texts
 *     call starts it once their morning begins (plan #2748.7).
 *   - Nothing piles up: with six texts unread, or three sent today, no
 *     text could be saved, so the round is not fired at all.
 *   - Someone can speak: a mentor with no reach-out rule and no unread
 *     text, whom the round chooses by judgement as before, or a person due
 *     by their own rule (plan #2931.5) with no unread text. A person with a
 *     rule speaks only when due, so a council of people with rules, none
 *     due, starts no round.
 *   - Memory still runs: when a conversation is due a summary (plan
 *     #2748.8), the round starts whatever the note caps say, and writes
 *     the mentors' memory with no notes.
 */
export function decideAdviceRun(input: {
  now: number;
  latest: { status: string; requestedAt: string } | null;
  unread: number;
  writtenToday: number;
  /** Mentors on the council with no reach-out rule and no unread text. */
  free: number;
  /** People due by their reach-out rule with no unread text (plan #2931.5). */
  due?: number;
  /** Mentor conversations over and due a summary. */
  episodesDue?: number;
  /** The person's quiet hours, when no mentor texts them. */
  quiet?: boolean;
}): AdviceDecision {
  const asked = input.latest ? Date.parse(input.latest.requestedAt) : NaN;
  if (input.latest && (input.latest.status === 'queued' || input.latest.status === 'running')) {
    if (!Number.isFinite(asked) || input.now - asked <= ADVICE_STALE_AFTER_MS) {
      return { start: false, skipped: 'a council round is already queued or running' };
    }
  }
  if (Number.isFinite(asked) && input.now - asked < ADVICE_GAP_MS) {
    return { start: false, skipped: 'a council round was asked for in the last day' };
  }
  if (input.quiet) return { start: false, skipped: 'it is quiet hours for the person' };
  if ((input.episodesDue ?? 0) > 0) return { start: true };
  if (input.unread >= UNREAD_MAX) return { start: false, skipped: `${input.unread} mentor texts are unread` };
  if (input.writtenToday >= NOTES_PER_DAY) return { start: false, skipped: 'the council has sent its texts for today' };
  if (input.free <= 0 && (input.due ?? 0) <= 0) {
    return { start: false, skipped: 'nobody is free to text: every mentor without a rule has an unread text, and nobody is due by their rule' };
  }
  return { start: true };
}

/** Start the daily round when decideAdviceRun says so. */
export async function maybeStartAdviceRun(input: {
  client: YouSupabaseClient;
  userId: string;
  routine: RoutineTarget;
  now?: number;
  fetch?: typeof globalThis.fetch;
  /** The person's quiet hours, when no mentor texts them. */
  quiet?: boolean;
  /**
   * A client for each schema, to read the tables reach-out rules watch
   * (plan #2931.5). Without it nobody is due by a rule, and people with a
   * rule stay silent.
   */
  db?: SchemaReader;
}): Promise<{ skipped: string } | { started: true; runId: string }> {
  const { client, userId } = input;
  const now = input.now ?? Date.now();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const quietSince = new Date(now - EPISODE_QUIET_MS).toISOString();
  const lately = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  const [latest, unread, today, roster, episodes] = await Promise.all([
    client
      .from('council_runs')
      .select('status, requested_at')
      .eq('user_id', userId)
      .eq('kind', 'advice')
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    readUnreadTexts(client, userId).then((data) => ({ data, error: null })),
    client
      .from('advisor_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('kind', 'text_first')
      .is('text_rule', null)
      .gte('created_at', dayStart.toISOString()),
    client.from('board_advisors').select('id').eq('user_id', userId).eq('active', true),
    // Over and unsummarised, or ended lately and perhaps grown after its
    // summary; PostgREST cannot compare two columns, so episodeDue settles it.
    client
      .from('advisor_episodes')
      .select('ended_at, summarised_at')
      .eq('user_id', userId)
      .lt('ended_at', quietSince)
      .or(`summarised_at.is.null,ended_at.gt.${lately}`)
      .order('ended_at', { ascending: false })
      .limit(200),
  ]);
  for (const r of [latest, unread, today, roster, episodes]) {
    if (r.error) throw new Error(`Reading the council failed: ${r.error.message}`);
  }
  const unreadBy = new Set((unread.data ?? []).map((r) => r.advisorId));
  // A person with a rule speaks only when it makes them due (plan #2931.5).
  const reach = input.db
    ? await loadReachOutDue({ you: client, db: input.db, userId, unreadBy, now })
    : { people: await readRulePeople(client, userId, unreadBy), due: [] };
  const ruled = new Set(reach.people.map((p) => p.advisorId));
  const free = ((roster.data ?? []) as { id: string }[]).filter((r) => !unreadBy.has(r.id) && !ruled.has(r.id)).length;
  const latestRow = latest.data as { status: string; requested_at: string } | null;
  const decision = decideAdviceRun({
    now,
    latest: latestRow ? { status: latestRow.status, requestedAt: latestRow.requested_at } : null,
    unread: (unread.data ?? []).length,
    writtenToday: today.count ?? 0,
    free,
    due: reach.due.length,
    quiet: input.quiet,
    episodesDue: ((episodes.data ?? []) as { ended_at: string; summarised_at: string | null }[]).filter((e) =>
      episodeDue({ endedAt: e.ended_at, summarisedAt: e.summarised_at }, now),
    ).length,
  });
  if (!decision.start) return { skipped: decision.skipped };

  const started = await queueAndFire({
    client,
    userId,
    kind: 'advice',
    routine: input.routine,
    brief: (runId) => adviceBrief({ runId, userId, due: reach.due }),
    staleAfterMs: ADVICE_STALE_AFTER_MS,
    now,
    fetch: input.fetch,
  });
  if (started.started) return started;
  if (started.reason === 'running') return { skipped: 'a council round is already queued or running' };
  if (started.reason === 'no_routine') return { skipped: 'the board routine is not set up on this deployment' };
  throw new Error(`The council round did not start: ${started.error}`);
}


export type SendResult = { error: string | null; saved: boolean };

/**
 * Send a mentor a message: find or start the talk, save the message, mark
 * the talk waiting and fire the board routine to write the reply. A message
 * is saved even when the reply cannot be started, and the talk then says why.
 */
export async function sendToMentor(input: {
  client: YouSupabaseClient;
  userId: string;
  mentor: Pick<Mentor, 'id' | 'name' | 'canTalk'>;
  text: string;
  noteId?: string | null;
  routine: RoutineTarget;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<SendResult> {
  const { client, userId, mentor } = input;
  const now = input.now ?? Date.now();
  const clean = cleanMessage(input.text);
  if (!clean.ok) return { error: clean.error, saved: false };
  if (!mentor.canTalk) return { error: `${mentor.name} cannot talk until their brain is built.`, saved: false };

  const found = await client
    .from('advisor_chats')
    .select('id, reply_status, reply_requested_at, reply_error')
    .eq('user_id', userId)
    .eq('advisor_id', mentor.id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  let chat = found.data ? chatOf(found.data as Record<string, unknown>) : null;
  if (chat && replyState(chat, now).kind === 'waiting') {
    return { error: `${mentor.name} is still writing back. Send this once the reply is in.`, saved: false };
  }
  if (!chat) {
    const made = await client
      .from('advisor_chats')
      .insert({ user_id: userId, advisor_id: mentor.id, title: `Talking with ${mentor.name}`.slice(0, 200) })
      .select('id, reply_status, reply_requested_at, reply_error')
      .single();
    if (made.error || !made.data) throw new Error(made.error?.message ?? 'Could not start the talk.');
    chat = chatOf(made.data as Record<string, unknown>);
    if (!chat) throw new Error('Could not start the talk.');
  }

  const message = await client
    .from('advisor_messages')
    .insert({ user_id: userId, chat_id: chat.id, role: 'person', text: clean.text, note_id: input.noteId ?? null });
  if (message.error) throw new Error(`Your message was not saved: ${message.error.message}`);
  if (input.noteId) await markNotesRead(client, userId, [input.noteId], now);

  const at = new Date(now).toISOString();
  await client
    .from('advisor_chats')
    .update({ reply_status: 'waiting', reply_requested_at: at, reply_error: null })
    .eq('user_id', userId)
    .eq('id', chat.id);

  const chatId = chat.id;
  const started = await queueAndFire({
    client,
    userId,
    kind: 'reply',
    chatId,
    routine: input.routine,
    brief: (runId) => replyBrief({ runId, chatId, userId }),
    staleAfterMs: REPLY_STALE_AFTER_MS,
    now,
    fetch: input.fetch,
  });
  if (started.started || started.reason === 'running') return { error: null, saved: true };

  const why = started.reason === 'no_routine' ? NO_ROUTINE_ERROR : `${mentor.name} could not start writing back. ${started.error}`;
  await client
    .from('advisor_chats')
    .update({ reply_status: 'failed', reply_error: why.slice(0, 2000) })
    .eq('user_id', userId)
    .eq('id', chatId);
  return { error: why, saved: true };
}

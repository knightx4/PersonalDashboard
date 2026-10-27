import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { decisionFromRow, verdictOf, type BoardVerdict, type QuestionDecision } from '@/lib/you/board-debate';
import { optionsOf, type BoardOption } from '@/lib/you/board-questions';
import { madeRefsOf, type GoalChoice, type MadeItem, type MadeRef } from '@/lib/you/board-make';

/**
 * Reading and writing what a decided question made (plan #2561.9): the list
 * in you.board_questions.made, and the rows it points at. Every call names the
 * person as well as relying on row level security.
 */

export type MakeSource = {
  id: string;
  question: string;
  options: BoardOption[];
  meetingId: string | null;
  verdict: BoardVerdict | null;
  decision: QuestionDecision | null;
  made: MadeRef[];
};

export async function loadMakeSource(
  client: YouSupabaseClient,
  userId: string,
  id: string,
): Promise<MakeSource | null> {
  const { data, error } = await client
    .from('board_questions')
    .select('id, question, options, status, meeting_id, verdict, decided_option, decision_note, decided_at, made')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    question: String(row.question ?? ''),
    options: optionsOf(row.options),
    meetingId: typeof row.meeting_id === 'string' ? row.meeting_id : null,
    verdict: verdictOf(row.verdict),
    decision: decisionFromRow(row),
    made: madeRefsOf(row.made),
  };
}

/** Add refs to the question's list, keeping what is there. False when the question is gone. */
export async function appendMade(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  added: readonly MadeRef[],
): Promise<boolean> {
  const { data, error } = await client
    .from('board_questions')
    .select('made')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  const next = [...madeRefsOf((data as { made: unknown }).made), ...added];
  const { data: saved, error: writeError } = await client
    .from('board_questions')
    .update({ made: next })
    .eq('user_id', userId)
    .eq('id', id)
    .select('id');
  if (writeError) throw new Error(writeError.message);
  return (saved ?? []).length > 0;
}

/** The todos and steps the questions made, as they are now. A row that is gone (an Undo took it) is left out. */
export async function resolveMade(
  clients: { todo: TodoSupabaseClient; goals: GoalsSupabaseClient },
  userId: string,
  byQuestion: ReadonlyMap<string, readonly MadeRef[]>,
): Promise<Map<string, MadeItem[]>> {
  const all = [...byQuestion.values()].flat();
  const todoIds = all.filter((m) => m.kind === 'todo').map((m) => m.id);
  const stepIds = all.filter((m) => m.kind === 'step').map((m) => m.id);
  const [tasks, steps] = await Promise.all([
    todoIds.length
      ? clients.todo.from('tasks').select('id, title, due_on, due_at, completed_at').eq('user_id', userId).in('id', todoIds)
      : Promise.resolve({ data: [], error: null }),
    stepIds.length
      ? clients.goals
          .from('items')
          .select('id, title, due_on, status, parent_id')
          .eq('user_id', userId)
          .in('id', stepIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tasks.error) throw new Error(`Reading the todos a decision made failed: ${tasks.error.message}`);
  if (steps.error) throw new Error(`Reading the steps a decision made failed: ${steps.error.message}`);
  const taskRows = new Map((tasks.data as Record<string, unknown>[]).map((r) => [String(r.id), r]));
  const stepRows = new Map((steps.data as Record<string, unknown>[]).map((r) => [String(r.id), r]));

  const goalIds = [...new Set(selectParents(stepRows))];
  const goalTitles = new Map<string, string>();
  if (goalIds.length) {
    const { data, error } = await clients.goals.from('items').select('id, title').eq('user_id', userId).in('id', goalIds);
    if (error) throw new Error(`Reading the goals a decision made steps under failed: ${error.message}`);
    for (const g of (data ?? []) as Record<string, unknown>[]) goalTitles.set(String(g.id), String(g.title ?? ''));
  }

  const out = new Map<string, MadeItem[]>();
  for (const [question, refs] of byQuestion) {
    const items = refs.flatMap((ref): MadeItem[] => {
      if (ref.kind === 'todo') {
        const row = taskRows.get(ref.id);
        if (!row) return [];
        return [
          {
            ...ref,
            title: String(row.title ?? ''),
            dueOn: typeof row.due_on === 'string' ? row.due_on : typeof row.due_at === 'string' ? row.due_at.slice(0, 10) : null,
            done: row.completed_at != null,
            href: `/todo/all?status=all&focus=${ref.id}`,
            goal: null,
          },
        ];
      }
      const row = stepRows.get(ref.id);
      if (!row) return [];
      const parent = typeof row.parent_id === 'string' ? row.parent_id : null;
      return [
        {
          ...ref,
          title: String(row.title ?? ''),
          dueOn: typeof row.due_on === 'string' ? row.due_on : null,
          done: row.status === 'done',
          href: parent ? `/goals/${parent}` : '/goals',
          goal: parent ? (goalTitles.get(parent) ?? null) : null,
        },
      ];
    });
    out.set(question, items);
  }
  return out;
}

function selectParents(rows: ReadonlyMap<string, Record<string, unknown>>): string[] {
  return [...rows.values()].flatMap((r) => (typeof r.parent_id === 'string' ? [r.parent_id] : []));
}

/** The goals a step can be written under: live ones, open or proposed, with their area. */
export async function loadGoalChoices(client: GoalsSupabaseClient, userId: string): Promise<GoalChoice[]> {
  const [goals, areas] = await Promise.all([
    client
      .from('items')
      .select('id, title, area_id, status, position')
      .eq('user_id', userId)
      .eq('level', 'goal')
      .in('status', ['open'])
      .is('archived_at', null)
      .order('position'),
    client.from('areas').select('id, name').eq('user_id', userId).is('archived_at', null),
  ]);
  if (goals.error) throw new Error(`Reading your goals failed: ${goals.error.message}`);
  if (areas.error) throw new Error(`Reading your areas failed: ${areas.error.message}`);
  const names = new Map(((areas.data ?? []) as Record<string, unknown>[]).map((a) => [String(a.id), String(a.name ?? '')]));
  return ((goals.data ?? []) as Record<string, unknown>[]).map((g) => ({
    id: String(g.id),
    title: String(g.title ?? ''),
    area: names.get(String(g.area_id)) ?? '',
  }));
}

/** The debate with what each question made filled in, read back from the todos and steps. */
export async function withMade<D extends { questions: { id: string; made: MadeItem[] }[] }>(
  you: YouSupabaseClient,
  clients: { todo: TodoSupabaseClient; goals: GoalsSupabaseClient },
  userId: string,
  debate: D,
): Promise<D> {
  const ids = debate.questions.map((q) => q.id);
  if (ids.length === 0) return debate;
  const { data, error } = await you.from('board_questions').select('id, made').eq('user_id', userId).in('id', ids);
  if (error) throw new Error(`Reading what the decisions made failed: ${error.message}`);
  const refs = new Map(
    ((data ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), madeRefsOf(r.made)] as const),
  );
  if ([...refs.values()].every((r) => r.length === 0)) return debate;
  const resolved = await resolveMade(clients, userId, refs);
  return { ...debate, questions: debate.questions.map((q) => ({ ...q, made: resolved.get(q.id) ?? [] })) };
}

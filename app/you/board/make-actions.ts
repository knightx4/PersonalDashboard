'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requestDashDeps } from '@/lib/ask/clients';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { recordDashAction } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { insertStep } from '@/lib/goals/steps-store';
import { todayInTimezone } from '@/lib/money';
import { createTask } from '@/lib/todo/tasks/write';
import { createYouClient } from '@/lib/you/auth/server';
import {
  backLink,
  clipTitle,
  makeCandidates,
  stillToMake,
  type MadeItem,
  type MadeRef,
  type MakeTarget,
} from '@/lib/you/board-make';
import { appendMade, loadMakeSource } from '@/lib/you/board-make-store';

export type MakeResult = { error: string | null; made?: MadeItem[] };

const questionId = z.string().uuid();

/**
 * Make it happen (plan #2561.9): write the picked actions and conditions of a
 * decided question as todos, or as steps under one of the person's goals.
 *
 * The page sends the keys the person picked, never text: the rows are built
 * here from the question's own option and verdict. A key already made is
 * skipped, so pressing twice writes once. Each row is recorded in
 * core.dash_actions, which is what puts it on Home with an Undo, and is
 * listed on the question (you.board_questions.made). The row's body links
 * back to the question.
 */
// latency: pending
export async function makeDecisionHappen(
  id: string,
  keys: string[],
  target: MakeTarget,
): Promise<MakeResult> {
  try {
    if (!questionId.safeParse(id).success) return { error: 'That is not a question for the board.' };
    const user = await requireUser();
    const client = await createYouClient();
    const source = await loadMakeSource(client, user.id, id);
    if (!source) return { error: 'That question is not yours or no longer exists.' };
    if (!source.decision || source.decision.kind !== 'option')
      return { error: 'Decide on an option first, then there is something to write.' };

    const { timezone } = await loadAccountSettings(user.id);
    const today = todayInTimezone(timezone);
    const wanted = new Set(keys);
    const picked = stillToMake(makeCandidates(source, today), source.made).filter((c) => wanted.has(c.key));
    if (picked.length === 0) return { error: 'Pick at least one thing to write.' };

    const goals = target.kind === 'goal' ? await createGoalsClient() : null;
    const goalTitle = goals && target.kind === 'goal' ? await goalTitleOf(goals, user.id, target.goalId) : null;
    const dash = await requestDashDeps(user.id);
    const link = backLink(source, source.meetingId, source.decision.option);
    const added: MadeRef[] = [];
    const items: MadeItem[] = [];
    let failure: string | null = null;

    for (const candidate of picked) {
      const title = clipTitle(candidate.text);
      if (target.kind === 'todo' || !goals) {
        const task = await createTask(
          user.id,
          { title, body: link, dueOn: candidate.dueOn, dueTime: null, pinned: false, tags: [] },
          timezone,
        );
        if (task.error || !task.id) {
          failure = task.error ?? 'A todo was not made.';
          break;
        }
        const ref: MadeRef = { kind: 'todo', id: task.id, key: candidate.key };
        await recordDashAction(dash, {
          surface: 'scheduled',
          kind: 'make_board_decision_todo',
          subjectRef: toRef('todo.tasks', task.id),
          op: 'insert',
          summary: `Dash made the todo "${title}" from your board decision.`,
        });
        added.push(ref);
        items.push({
          ...ref,
          title,
          dueOn: candidate.dueOn,
          done: false,
          href: `/todo/all?status=all&focus=${task.id}`,
          goal: null,
        });
      } else {
        const stepId = await insertStep(goals, user.id, target.goalId, {
          title,
          kind: 'mine',
          detail: link,
          due_on: candidate.dueOn,
        });
        if (!stepId) {
          failure = 'That goal is no longer open, so nothing more was written under it.';
          break;
        }
        const ref: MadeRef = { kind: 'step', id: stepId, key: candidate.key };
        await recordDashAction(dash, {
          surface: 'scheduled',
          kind: 'make_board_decision_step',
          subjectRef: toRef('goals.items', stepId),
          op: 'insert',
          summary: `Dash made the step "${title}"${goalTitle ? ` under "${goalTitle}"` : ''} from your board decision.`,
        });
        added.push(ref);
        items.push({
          ...ref,
          title,
          dueOn: candidate.dueOn,
          done: false,
          href: `/goals/${target.goalId}`,
          goal: goalTitle,
        });
      }
    }

    if (added.length > 0) {
      await appendMade(client, user.id, id, added);
      revalidatePath('/you/board');
      revalidatePath(target.kind === 'todo' ? '/todo' : '/goals');
      revalidatePath('/home');
    }
    if (failure) {
      return {
        error: added.length > 0 ? `${failure} The ${added.length} before it were written.` : failure,
        made: items,
      };
    }
    return { error: null, made: items };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Nothing was written. Try again.' };
  }
}

async function goalTitleOf(
  client: Awaited<ReturnType<typeof createGoalsClient>>,
  userId: string,
  goalId: string,
): Promise<string | null> {
  const { data } = await client.from('items').select('title').eq('user_id', userId).eq('id', goalId).maybeSingle();
  return (data as { title?: string } | null)?.title ?? null;
}

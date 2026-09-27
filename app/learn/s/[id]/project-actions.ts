'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadCurriculum } from '@/lib/learn/graph/curriculum-store';
import { MARK_POINTS_MODEL } from '@/lib/learn/lessons/mark-points';
import { planGoalFor } from '@/lib/learn/lessons/plan-store';
import { handedInSomething, lineUpFigures } from '@/lib/learn/lessons/practice';
import { PROJECT_ANSWER_MAX, type PlanForProject, type ProjectView } from '@/lib/learn/lessons/project';
import { loadProjectRow, projectViewOf } from '@/lib/learn/lessons/project-store';
import { markProject, WRITE_PROJECT_MODEL, writeProject } from '@/lib/learn/lessons/write-project';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * The presses on a plan's final project (plan #1146, LEARN-LESSONS-SPEC "A
 * plan ends with a final project"): writing its brief, as the plan page opens
 * with none, and handing it in. Nothing locks: the project can be handed in
 * whatever pieces are passed, and again after a miss.
 */

const Id = z.string().uuid();

/** The plan the brief is written from, or null when this track is no goal's plan. */
async function loadPlanForProject(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<PlanForProject | null> {
  const goal = await planGoalFor(learn, userId, subjectId);
  if (!goal) return null;
  const [aim, units] = await Promise.all([
    learn.from('aims').select('about, depth').eq('user_id', userId).eq('id', goal.aimId).maybeSingle(),
    loadCurriculum(learn, subjectId, userId),
  ]);
  if (aim.error) throw new Error(`Reading the goal failed: ${aim.error.message}`);
  const row = aim.data as { about: string | null; depth: string | null } | null;
  return {
    goal: goal.name,
    about: row?.about ?? null,
    depth: row?.depth ?? null,
    units: units.map((unit) => ({
      ordinal: unit.ordinal,
      title: unit.title,
      covers: unit.covers || null,
      outcome: unit.outcome || null,
    })),
  };
}

export type ProjectResult = { error?: string; project?: ProjectView };

/**
 * Writing the plan's final project, as the plan page opens when it has none,
 * and on Write the project after that fails. Sonnet writes it from the plan's
 * outline. A project already there, from another tab, is shown rather than
 * paid for again.
 */
// latency: pending
export async function writePlanProject(subjectId: string): Promise<ProjectResult> {
  const user = await requireUser();
  const id = Id.safeParse(subjectId);
  if (!id.success) return { error: 'Could not tell which plan that was.' };
  const learn = await createLearnClient();

  try {
    const existing = await loadProjectRow(learn, user.id, id.data);
    if (existing) return { project: await projectViewOf(learn, user.id, existing) };

    const plan = await loadPlanForProject(learn, user.id, id.data);
    if (!plan) return { error: 'This track is not a learning goal’s plan.' };
    if (plan.units.length === 0) return { error: 'This plan has no units to set a project from yet.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Writing the final project needs ANTHROPIC_API_KEY to be set.' };

    const spend = collectSpend();
    let written = await writeProject({ plan, anthropicApiKey: apiKey, onSpend: spend.sink });
    // A brief that came back without its points, title or worked answer is
    // thrown out; one more try usually lands.
    if (written.outcome === 'dropped') {
      written = await writeProject({ plan, anthropicApiKey: apiKey, onSpend: spend.sink });
    }
    await recordLearnSpend(user.id, 'write-plan-project', spend.reports);
    if (written.outcome === 'failed') return { error: `Writing the project failed: ${written.detail}` };
    if (written.outcome === 'dropped') return { error: 'Dash could not write a usable project this time. Try again.' };

    const { project } = written;
    const { error } = await learn.from('plan_projects').insert({
      user_id: user.id,
      subject_id: id.data,
      title: project.title,
      task: project.task,
      data: project.data,
      figures: project.figures,
      points: project.points,
      worked: project.worked,
      spreadsheet_note: project.spreadsheetNote,
      write_model: WRITE_PROJECT_MODEL,
    });
    // 23505: another tab wrote the plan's project first; show that one.
    if (error && error.code !== '23505') return { error: `Saving the project failed: ${error.message}` };

    const saved = await loadProjectRow(learn, user.id, id.data);
    if (!saved) return { error: 'The project was not saved.' };
    return { project: await projectViewOf(learn, user.id, saved) };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not write the project.' };
  }
}

const HandInFigures = z
  .array(z.object({ label: z.string().max(200), value: z.string().max(1000) }))
  .max(20);

/**
 * Hand it in. Haiku marks what was typed against each point the brief listed,
 * saying what was right and what was missing. Every point met passes the
 * project; the plan is finished once every piece is passed too, which the
 * page works out when it reloads. A hand-in that misses a point can be handed
 * in again.
 */
// latency: pending
export async function handInPlanProject(
  subjectId: string,
  projectId: string,
  answer: string,
  figures: { label: string; value: string }[],
): Promise<ProjectResult> {
  const user = await requireUser();
  const ids = z.tuple([Id, Id]).safeParse([subjectId, projectId]);
  if (!ids.success) return { error: 'Could not tell which project that was.' };
  const typed = HandInFigures.safeParse(figures);
  if (!typed.success) return { error: 'Could not read the figures handed in.' };
  const [subject, projectIdValue] = ids.data;
  const working = String(answer ?? '').trim().slice(0, PROJECT_ANSWER_MAX);
  const learn = await createLearnClient();

  try {
    const row = await loadProjectRow(learn, user.id, subject);
    if (!row || row.id !== projectIdValue) return { error: 'That project is no longer there.' };
    const current = await projectViewOf(learn, user.id, row);
    // Passed already, in another tab: show that rather than paying to mark it again.
    if (current.passed) return { project: current };

    const lined = lineUpFigures(current.figures, typed.data);
    if (!handedInSomething(working, lined)) return { error: 'Type in the figures or your working first.' };

    const plan = await loadPlanForProject(learn, user.id, subject);
    if (!plan) return { error: 'This track is not a learning goal’s plan.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Marking a hand-in needs ANTHROPIC_API_KEY to be set.' };

    const spend = collectSpend();
    const marked = await markProject({
      plan,
      task: row.task,
      points: row.points,
      worked: row.worked,
      handIn: { answer: working, figures: lined },
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'mark-plan-project', spend.reports);
    if (!marked.ok) return { error: `Marking failed: ${marked.detail}` };

    const { error } = await learn.from('plan_project_handins').insert({
      user_id: user.id,
      project_id: row.id,
      answer: working,
      figures: lined,
      marks: marked.marks,
      passed: marked.passed,
      mark_model: MARK_POINTS_MODEL,
    });
    if (error) return { error: `Recording the hand-in failed: ${error.message}` };

    if (marked.passed) {
      // The plan's header, Learn now and the Goals page read finished from this.
      revalidatePath(`/learn/s/${subject}`);
      revalidatePath('/learn/now');
      revalidatePath('/learn/goals');
    }
    return { project: await projectViewOf(learn, user.id, row) };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not mark that.' };
  }
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { threadText } from '@/lib/comments/context';
import { planRoutine } from '@/lib/feedback/routine';
import { IDEA_COLUMNS, IDEAS_TABLE, ideaRowFrom } from '@/lib/ideas/load';
import { MODULES } from '@/lib/modules';
import { COMPLETE_DETAIL_RULE, FOLLOW_ON_RULE, PLAIN_ENGLISH_RULE, QUESTION_RULE, visionFor } from '@/lib/plan/brief';
import { startRoutineRun } from '@/lib/plan/runs';
import { loadVisionBodies } from '@/lib/specs/vision';
import { loadDevProjects } from '@/lib/plan/projects';
import { withThreads } from '@/lib/thread/store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public'>;

export type ShapeResult = { ok: true } | { ok: false; error: string };

/**
 * Hand an idea to a session to be shaped into the plan: the Shape button on
 * the ideas page, and a note the header filed that triage moved to the ideas
 * page (note 677a1cdd), which goes straight on to be shaped.
 *
 * Not to be built. The session that wakes up reads the idea and the code and
 * writes a feature with its steps into the plan as *proposed*, each with a
 * done-when and a size, waiting to be approved on the plan page. Nothing is
 * started until a person says so there. The same routine the notes queue
 * fires, with a different job in the extra turn. Only the caller's own idea.
 */
export async function shapeIdeaRun(supabase: Client, userId: string, ideaId: string): Promise<ShapeResult> {
  // The whole row rather than the four columns the turn used to name, because
  // the thread comes with it. What was said underneath an idea is usually the
  // half that says what it actually means -- the first sentence is a note to
  // self, and the shape it should take was worked out in the replies.
  const { data } = await supabase
    .from('ideas')
    .select(IDEA_COLUMNS)
    .eq('user_id', userId)
    .eq('id', ideaId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'That idea no longer exists.' };
  const [withThread] = await withThreads(supabase, IDEAS_TABLE, [data as unknown as Record<string, unknown>], {
    userId,
  });
  const idea = ideaRowFrom(withThread);
  if (idea.planItem) return { ok: false, error: 'This idea is already in the plan.' };

  const scope = idea.module;
  // An idea under a Dev project (filed from its app's note button) is about code in the project's own
  // repository: the plan rows are written here, but the code to read is there.
  const project = scope && !MODULES.some((m) => m.id === scope)
    ? (await loadDevProjects(supabase, userId).catch(() => [])).find((p) => p.id === scope) ?? null
    : null;
  const label = project ? `the ${project.label} project` : scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'the app as a whole';
  const projectNote = project
    ? `This idea is about the Dev project ${project.label}, built in its own repository ` +
      `${project.repo.owner}/${project.repo.repo}. Read the code it touches there (attach the repository, or read its ` +
      'files through the GitHub tools) before writing the steps, and write the feature with `--module ' +
      `${project.id}\` so it lands on the project's page. Its steps are built by the projects dispatcher in that repository.\n\n`
    : '';
  const said = threadText(idea.thread);
  // The feature has to name the part of this vision it serves (shaping.md),
  // chosen by the same rule as a step brief's: the workspace's, or the app's
  // for an idea about the whole app, and none for a workspace without one.
  const vision = visionFor({ module: scope }, await loadVisionBodies(supabase, userId));

  const text =
    `Shape idea ${String(idea.id).slice(0, 8)} into the plan, following ` +
    '.claude/skills/plan/reference/shaping.md, and .claude/skills/plan/reference/writing.md for ' +
    'how every row is worded. Write a proposal only: a feature with its steps, ' +
    'each with a done-when and a size, all in the proposed status and linked back to the idea. ' +
    'Do not build anything and do not approve anything.\n\n' +
    `${PLAIN_ENGLISH_RULE}\n\n${FOLLOW_ON_RULE}\n\n${COMPLETE_DETAIL_RULE}\n\n${QUESTION_RULE}\n\n` +
    projectNote +
    (vision ? `## Vision\n\n${vision}\n\n` : '') +
    `Idea ${idea.id} (about ${label}):\n\n${idea.body}\n` +
    (said ? `\n${said}` : '');

  const result = await startRoutineRun({
    supabase,
    userId,
    job: 'shape',
    routine: planRoutine(),
    // No step: the proposal the session writes is what will carry the number,
    // and it does not exist yet.
    text,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

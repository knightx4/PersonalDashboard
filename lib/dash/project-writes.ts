import type Anthropic from '@anthropic-ai/sdk';
import type { PostChangeInput, PostChangeKind } from '@/lib/ask/post-changes';
import { toRef } from '@/lib/core/refs';
import {
  addDevProject,
  listGithubRepositories,
  parseRepositoryName,
  repositoryByName,
} from '@/lib/plan/project-add';
import { loadDevProjects, PROJECT_COLUMNS } from '@/lib/plan/projects';
import { decidesSomething } from '@/lib/plan/decision-titles';
import { insertPlanItem } from '@/lib/plan/insert-item';
import { nextPlanPosition } from '@/lib/plan/position';
import { MODULE_IDS } from '@/lib/modules';
import { sameAs } from './runs';
import { keepSlip, sameStepTitle, type DashSlipKind } from './slips';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The project Dash adds when asked (plan #2553.5, feature #2553):
 *
 *   add_project  one of the person's GitHub repositories added as a Dev
 *                project, with its own section on the plan, as the Projects
 *                page's picker adds it.
 *
 * Both go through addDevProject (lib/plan/project-add.ts): the repository is
 * read from GitHub for its branch, description and homepage, one already
 * added is refused, and one archived is put back. A bare name ("my recipes
 * repo") is matched against the repositories GITHUB_READ_TOKEN lists.
 *
 * A new project comes with a "Set up" feature and its first ready step
 * (lib/plan/project-setup.ts, plan #2553.6). Undo archives a project it
 * added, since those rows are filed under it (archivesProject in
 * lib/core/dash-actions.ts), and archives again one it put back.
 */

class Refused extends Error {}

type Args = Record<string, unknown>;

const TABLE = 'public.dev_projects';
const PROJECTS_HREF = '/dev/projects';

const DONE_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you added, and cite the row this returned.';

async function addProject(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  const named = typeof args.repository === 'string' ? args.repository.trim() : '';
  if (!named) throw new Refused('repository is missing: name it as owner/name, or by its name.');

  let repository = parseRepositoryName(named);
  if (!repository) {
    const listing = await listGithubRepositories();
    const found = repositoryByName(named, listing.repositories);
    if ('error' in found) throw new Refused(listing.error ? `${found.error} (${listing.error})` : found.error);
    repository = found;
  }

  const db = await ctx.db('public');
  const read = async (id: string) =>
    ((await db.from('dev_projects').select(PROJECT_COLUMNS).eq('user_id', ctx.userId).eq('id', id).maybeSingle())
      .data as Record<string, unknown> | null) ?? null;
  // What an archived row held, for the undo that archives it again.
  const wanted = `${repository.owner}/${repository.repo}`.toLowerCase();
  const earlier = (await loadDevProjects(db, ctx.userId)).find(
    (project) => `${project.repo.owner}/${project.repo.repo}`.toLowerCase() === wanted,
  );
  const before = earlier ? await read(earlier.id) : null;
  const result = await addDevProject({ db, userId: ctx.userId, repository });
  if (!result.ok) throw new Refused(`${result.error} Nothing was added.`);

  const { project, restored, setUp } = result;
  const after = await read(project.id);
  const href = `/dev/projects/${project.id}`;
  const input: PostChangeInput = {
    verb: restored ? 'Put back the project' : 'Added the project',
    what: project.label,
    rest: `, built in ${project.repo.owner}/${project.repo.repo}`,
    href,
    where: 'Open the project',
    paths: [PROJECTS_HREF, '/dev/plan', href],
  };
  return {
    ok: true,
    kind: 'add_project' satisfies PostChangeKind,
    input: input as unknown as Record<string, unknown>,
    subjectRef: toRef(TABLE, project.id),
    op: restored ? 'update' : 'insert',
    before: restored ? before : null,
    after,
    summary:
      `Dash ${restored ? 'put back' : 'added'} the project ${project.label}, built in ${project.repo.owner}/${project.repo.repo}. It has its own section on the plan.` +
      (setUp && !('error' in setUp)
        ? ` Its first step, under Set up, readies the repository for Dash: press Send to Dash on it.`
        : setUp
          ? ` Its set-up step could not be written (${setUp.error}).`
          : ''),
    row: { table: TABLE, ref: project.id, title: project.label, href },
    ...(restored ? {} : { undo: { archive_project: true } }),
  };
}

const MAX_TITLE = 200;
const MAX_DETAIL = 4000;
/**
 * The shortest detail a step from a chat may have (plan #2999). On 5 November
 * 2026 the Builder added nine steps with a title alone; a builder cannot
 * build from a title, and the person had to undo each one.
 */
export const MIN_DETAIL = 200;
/** A step whose title repeats one added this recently is refused as a repeat (plan #2999). */
export const REPEAT_WINDOW_MS = 30 * 60 * 1000;
const STEP_TABLE = 'public.plan_items';

/** Keeps the refusal as a slip for Dev Home's count, then refuses with what the model is told. */
async function refuseAndKeep(ctx: DashWriteContext, kind: DashSlipKind, what: string, told: string): Promise<never> {
  // Ask and People name themselves; a row's comment thread is the one caller that does not.
  const where = ctx.slipWhere ?? { surface: 'thread' as const, conversation: null, href: null };
  try {
    await keepSlip((await ctx.db('core')) as never, ctx.userId, { ...where, kind, tool: 'add_plan_step', what });
  } catch (error) {
    console.error('the add_plan_step refusal was not kept', error);
  }
  throw new Refused(told);
}

/**
 * The step this title repeats, when one with the same or nearly the same
 * title was added in the last half hour and is still there. One that was
 * undone has been deleted, so it is never found.
 */
async function recentRepeat(
  db: Awaited<ReturnType<DashWriteContext['db']>>,
  userId: string,
  title: string,
  now: number,
): Promise<{ number: number; title: string } | null> {
  const since = new Date(now - REPEAT_WINDOW_MS).toISOString();
  const { data } = await db
    .from('plan_items')
    .select('number, title, status, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .neq('status', 'dropped');
  const rows = (data ?? []) as { number: number; title: string }[];
  return rows.find((row) => sameStepTitle(row.title, title)) ?? null;
}

/**
 * A step on the plan, as the plan page's Add and a comment's add_step write
 * it: always `proposed`, which is no work until the person approves it on the
 * page. Nothing here sets a status, assignee or priority. With `under` it
 * hangs beneath that step and takes its workspace; without, it goes at the top
 * of the named workspace (or the app as a whole).
 *
 * Every caller is a chat (Ask Dash, a People thread, a row's thread), so a
 * detail shorter than MIN_DETAIL is refused, and so is a title that repeats a
 * step added in the last half hour (plan #2999). Nothing is written on a
 * refusal, and each is kept in core.dash_slips.
 */
async function addPlanStep(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) throw new Refused('title is missing: say what the step is in a short line.');
  if (title.length > MAX_TITLE) {
    throw new Refused(`That title is longer than a step's name can be (${MAX_TITLE} characters). Put the rest in detail.`);
  }
  // A step that asks them to choose is a question, not work (note 35687c09):
  // ask it in this conversation with the options, rather than filing a step.
  if (decidesSomething(title)) {
    throw new Refused(
      `"${title}" asks them to choose, and a step is work to build. Ask them the question here with two to four options and your recommendation, and add the step for the option they pick.`,
    );
  }
  const detail = typeof args.detail === 'string' ? args.detail.trim() : '';
  if (detail.length > MAX_DETAIL) {
    throw new Refused(`That detail is longer than a step's can be (${MAX_DETAIL} characters).`);
  }
  const db = await ctx.db('public');

  const repeat = await recentRepeat(db, ctx.userId, title, ctx.now ?? Date.now());
  if (repeat) {
    await refuseAndKeep(
      ctx,
      'repeated_step',
      `add_plan_step "${title}" repeats #${repeat.number} "${repeat.title}", added in the last half hour.`,
      `Nothing was added: #${repeat.number} "${repeat.title}" was added in the last half hour and says the same. Do not add it again. Tell them it is #${repeat.number}, and do not say a new step was added.`,
    );
  }
  if (detail.length < MIN_DETAIL) {
    await refuseAndKeep(
      ctx,
      'thin_step',
      detail
        ? `add_plan_step "${title}" was called with a detail of ${detail.length} characters.`
        : `add_plan_step "${title}" was called with no detail.`,
      `Nothing was added: ${detail ? `the detail is ${detail.length} characters` : 'there is no detail'}, and a step needs at least ${MIN_DETAIL}, since a builder reads only the step. Call add_plan_step again now, in this same turn, with the full detail: why they want it, where it goes, what done looks like, and every constraint, file, example and decision from this conversation.`,
    );
  }

  let parentId: string | null = null;
  let scope: string | null = null;
  if (args.under !== undefined && args.under !== null && args.under !== '') {
    const number = Number(String(args.under).replace(/^#/, '').split('.')[0]);
    const ref = typeof args.under === 'string' && /^[0-9a-f-]{36}$/i.test(args.under) ? args.under : null;
    let query = db.from('plan_items').select('id, module').eq('user_id', ctx.userId);
    query = ref ? query.eq('id', ref) : query.eq('number', number);
    const { data } = await query.maybeSingle();
    const parent = data as { id: string; module: string | null } | null;
    if (!parent) throw new Refused(`No step on the plan is numbered ${String(args.under)}. Look it up with read_dev_row or find_dev_text.`);
    parentId = parent.id;
    scope = parent.module;
  } else if (typeof args.module === 'string' && args.module.trim()) {
    scope = args.module.trim();
    if (!(MODULE_IDS as readonly string[]).includes(scope)) {
      throw new Refused(`"${scope}" is not a workspace. Use one of ${MODULE_IDS.join(', ')}, or leave it out for the app as a whole.`);
    }
  }

  const position = await nextPlanPosition(db, ctx.userId, scope as never, parentId);
  const written = await insertPlanItem(db, {
    userId: ctx.userId,
    module: scope,
    parentId,
    title,
    detail,
    status: 'proposed',
    kind: 'build',
    position,
  });
  if ('error' in written) throw new Error(written.error);
  const href = `/dev/plan/${written.number}`;
  const ref = toRef(STEP_TABLE, written.id);
  const after =
    ((await db.from('plan_items').select('*').eq('user_id', ctx.userId).eq('id', written.id).maybeSingle())
      .data as Record<string, unknown> | null) ?? null;
  const input: PostChangeInput = {
    verb: 'Added the step',
    what: `#${written.number} ${title}`,
    rest: ', proposed for you to approve',
    href,
    where: 'Open the step',
    paths: ['/dev/plan', href],
  };
  return {
    ok: true,
    kind: 'add_plan_step' satisfies PostChangeKind,
    input: input as unknown as Record<string, unknown>,
    subjectRef: ref,
    op: 'insert',
    before: null,
    after,
    // Says how much detail went in, so a reply has no room to claim more (plan #2999).
    summary: `Dash added the plan step #${written.number} "${title}" as a proposal, with a detail of ${detail.length} characters. It is not work until you approve it.`,
    row: { table: STEP_TABLE, ref: written.id, title: `#${written.number} ${title}`, href },
  };
}

/** Runs a write, turning a refusal or a failure into the sentence the model reads. Never throws. */
function guarded(name: string, run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>) {
  return async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const args = input && typeof input === 'object' ? (input as Args) : {};
    try {
      return await run(ctx, args);
    } catch (error) {
      if (error instanceof Refused) return { ok: false, error: error.message };
      console.error(`dash write ${name} failed`, error);
      return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
    }
  };
}

const NAME: PostChangeKind = 'add_project';

const INPUT: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    repository: {
      type: 'string',
      description:
        'The repository as owner/name ("alex-rivera/recipes"), a github.com link, or just its name as they said it ("recipes").',
    },
  },
  required: ['repository'],
  additionalProperties: false,
};

const STEP_INPUT: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What the step is, in a short line of their words.' },
    detail: { type: 'string', description: 'Everything a builder needs that the title leaves out: why, where, what done looks like, and every constraint, file, example, edge case and decision from the whole conversation, including what you worked out with them, not only their own words. Do not summarise specifics away.' },
    module: {
      type: 'string',
      description: 'The workspace it belongs to, by id (dev, jobs, goals and so on); leave it out for the app as a whole. Ignored when under is given.',
    },
    under: {
      type: 'string',
      description: 'The number of a step it belongs beneath ("2483" or "#2483.5"), when they say it is part of that one. It takes that step\'s workspace.',
    },
  },
  // Required since plan #2999: while it was optional, a chat left it out.
  required: ['title', 'detail'],
  additionalProperties: false,
};

/** The project write tools, in the order the model is sent them. */
export const PROJECT_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  {
    name: 'add_project',
    kind: 'write',
    runs: sameAs(['app/dev/projects/actions.ts#addProject', 'lib/plan/project-add.ts#addDevProject']),
    definition: {
      name: NAME,
      description: `Add one of their GitHub repositories as a project in Dev, when they ask ("add my recipes repo as a project"). It gets its own section on the plan, and Dash builds its steps in that repository. Name it by owner/name, or by its name alone and it is looked up among the repositories they have on GitHub; a name that matches none or several is refused with the matches, so ask which. One already added is refused, and one they archived is put back. ${DONE_NOTE}`,
      input_schema: INPUT,
    },
    apply: guarded(NAME, addProject),
  },
  {
    name: 'add_plan_step',
    kind: 'write',
    runs: sameAs(['lib/comments/act.ts#addStep', 'lib/plan/insert-item.ts#insertPlanItem']),
    definition: {
      name: 'add_plan_step',
      description: `Add a step to the build plan in Dev, when they ask for one ("add a step to move the Overnight panel to Home"). It arrives as a proposal for them to approve on the plan page; it is not built and nothing starts. Write the title in a short line and put everything in detail, complete enough for a builder who reads only the step to build from it. When they plan something with you in chat, whether they give detailed instructions or ask you to think it through first, everything worked out in that conversation goes into the detail (every constraint, file, example, edge case and decision, yours as well as theirs), not only what they typed. detail is required and must be at least ${MIN_DETAIL} characters: a call with a title alone, or a thin detail, is refused and nothing is added, so write the detail in full on the first call. A step with the same title as one added in the last half hour is refused as a repeat; say the outline it returns. Say only what the result says was added. ${DONE_NOTE}`,
      input_schema: STEP_INPUT,
    },
    apply: guarded('add_plan_step', addPlanStep),
  },
];

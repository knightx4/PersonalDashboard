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
import { sameAs } from './runs';
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
 * Undo deletes a row it added while nothing is filed under it, and archives
 * again one it put back, by the one undo rule in lib/core/dash-actions.ts.
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

  const { project, restored } = result;
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
    summary: `Dash ${restored ? 'put back' : 'added'} the project ${project.label}, built in ${project.repo.owner}/${project.repo.repo}. It has its own section on the plan.`,
    row: { table: TABLE, ref: project.id, title: project.label, href },
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
        'The repository as owner/name ("knightx4/recipes"), a github.com link, or just its name as they said it ("recipes").',
    },
  },
  required: ['repository'],
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
];

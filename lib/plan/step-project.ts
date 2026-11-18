/**
 * Which project a new plan step is filed under (plan #3095).
 *
 * #3064 and its steps were code for the music studio's repository, and the
 * first line of #3064's detail said "Repository: knightx4/music-pipeline".
 * Bob added them with add_plan_step after MaeMae passed them on, and they
 * landed under the app as a whole, so the plan routine picked them up and
 * could not check that repository out. The projects dispatcher, which starts
 * sessions on a project's own repository, never saw them.
 *
 * Every writer of a new step asks `fileStep` where it goes, in this order:
 *
 *   1. A step under another takes its parent's scope, project or workspace.
 *   2. A project the caller named outright (add_plan_step's `project`).
 *   3. The repository the title or detail names, when it is one of the
 *      account's active projects. A "Repository:" or "Repo:" line counts
 *      first; failing one, a github.com link or the project's own owner/name
 *      anywhere, when they name exactly one repository.
 *   4. The project a bot asking or passing the request on is tied to
 *      (dev_projects.bot_id, migration 0318: MaeMae and the music studio).
 *   5. What the caller would have filed it under anyway: a workspace, or
 *      the app as a whole.
 *
 * A step that names a repository which is neither this app's nor a project
 * stays where rule 5 put it, and `flag` carries a line saying so, which the
 * writer keeps on the step's history.
 */
import { isModuleId } from '@/lib/modules';
import { REPO, type Repo } from './github';
import { activeProjects, type DevProject, type PlanScope } from './projects';

export type StepFiling = {
  scope: PlanScope | null;
  /** Why it went there, for a writer's summary and the tests. */
  why: 'parent' | 'asked' | 'repo' | 'bot' | 'default';
  /** A line for the step's history when it names a repository that is not a project; else null. */
  flag: string | null;
};

export type StepFilingInput = {
  title: string;
  detail: string | null | undefined;
  /** The account's projects, archived ones included (only active ones take steps). */
  projects: readonly DevProject[];
  /** The parent's stored scope, when the step goes under one; undefined when it has none. */
  parentScope?: PlanScope | null;
  /** A project id the caller named outright. */
  project?: string | null;
  /** The bots asking for the step or passing the request on, by you.board_advisors id. */
  botIds?: readonly (string | null | undefined)[];
  /** Where the caller files it otherwise: a workspace, or null for the app as a whole. */
  fallback?: PlanScope | null;
  /** This app's repository; REPO outside tests. */
  appRepo?: Pick<Repo, 'owner' | 'repo'>;
};

type Named = { owner: string; repo: string };

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const NAME = '[A-Za-z0-9._-]{1,100}';
/** "Repository: owner/name" or "Repo: owner/name", a github.com link allowed after the colon. */
const LABELLED = new RegExp(
  `\\brepo(?:sitory)?\\s*:\\s*(?:https?://)?(?:www\\.)?(?:github\\.com/)?(${OWNER})/(${NAME})`,
  'gi',
);
const LINK = new RegExp(`github\\.com/(${OWNER})/(${NAME})`, 'gi');

const keyOf = (named: Named): string =>
  `${named.owner}/${named.repo.replace(/\.git$/i, '').replace(/[.,;:)]+$/, '')}`.toLowerCase();

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => keyOf({ owner: m[1], repo: m[2] }));
}

/** The repositories a step's text names, as lower-case owner/name: labelled lines first, then links. */
export function namedRepositories(
  text: string,
  projects: readonly DevProject[] = [],
  known: readonly Named[] = [],
): { labelled: string[]; mentioned: string[] } {
  const labelled = [...new Set(matches(text, LABELLED))];
  const mentioned = new Set(matches(text, LINK));
  // A project's own owner/name, or this app's, counts anywhere as a whole word.
  const lower = text.toLowerCase();
  for (const repo of [...projects.map((p) => p.repo), ...known]) {
    const key = keyOf(repo);
    if (key === '/') continue;
    const at = lower.indexOf(key);
    if (at < 0) continue;
    const before = at === 0 ? '' : lower[at - 1];
    const after = lower[at + key.length] ?? '';
    if (!/[a-z0-9/_-]/.test(before) && !/[a-z0-9_-]/.test(after)) mentioned.add(key);
  }
  return { labelled, mentioned: [...mentioned].filter((key) => !labelled.includes(key)) };
}

/** Where a new step is filed, and any flag it carries. */
export function fileStep(input: StepFilingInput): StepFiling {
  const fallback = input.fallback ?? null;
  if (input.parentScope !== undefined) return { scope: input.parentScope, why: 'parent', flag: null };

  const live = activeProjects(input.projects);
  const asked = input.project?.trim();
  if (asked) {
    const project = live.find((p) => p.id === asked);
    if (project) return { scope: project.id, why: 'asked', flag: null };
  }

  const appRepo = input.appRepo ?? REPO;
  const app = keyOf(appRepo);
  const byRepo = new Map(live.map((p) => [keyOf(p.repo), p]));
  const { labelled, mentioned } = namedRepositories(`${input.title}\n${input.detail ?? ''}`, live, [appRepo]);
  const others = (keys: string[]) => keys.filter((key) => key !== app);

  // A labelled line says where the work is; the first one decides.
  const first = labelled[0];
  let stranger: string | null = null;
  if (first) {
    if (first === app) return { scope: fallback, why: 'default', flag: null };
    const project = byRepo.get(first);
    if (project) return { scope: project.id, why: 'repo', flag: null };
    stranger = first;
  } else {
    // Unlabelled, a mention decides only when it is the one repository named.
    const all = [...new Set(mentioned)];
    if (all.length === 1 && all[0] !== app) {
      const project = byRepo.get(all[0]);
      if (project) return { scope: project.id, why: 'repo', flag: null };
    }
    stranger = others(all).find((key) => !byRepo.has(key)) ?? null;
  }

  if (!stranger) {
    const bots = new Set((input.botIds ?? []).filter((id): id is string => !!id));
    const tied = live.find((p) => p.botId && bots.has(p.botId));
    if (tied) return { scope: tied.id, why: 'bot', flag: null };
  }

  return {
    scope: fallback,
    why: 'default',
    flag: stranger
      ? `Names the repository ${stranger}, which is not one of the projects in Dev, so it was filed under ${
          fallback && isModuleId(fallback) ? `the ${fallback} workspace` : 'the app as a whole'
        }. Add the repository on Dev's Projects page and move the step there if it is built in that repository.`
      : null,
  };
}

/** The flag as a dated history line, appended to whatever the step's comment already holds. */
export function flagComment(flag: string | null, comment: string | null = null, now = new Date()): string | null {
  if (!flag) return comment;
  const line = `Flagged ${now.toISOString().slice(0, 10)}: ${flag}`;
  return comment ? `${comment}\n\n${line}` : line;
}

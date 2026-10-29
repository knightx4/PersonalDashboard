/**
 * Adding a GitHub repository as a Dev project, and putting one away
 * (plan #2553.5, feature #2553).
 *
 * The Projects page's picker lists the repositories GITHUB_READ_TOKEN can see,
 * newest pushed first. Choosing one reads the repository from GitHub (its
 * default branch, description and homepage) and writes a `dev_projects` row
 * (migration 0282), so the project has its own section on /dev/plan on the
 * next draw, with a "Set up" feature and its first ready step in it
 * (lib/plan/project-setup.ts, plan #2553.6). Ask Dash's `add_project` goes
 * through the same `addDevProject`, so the two cannot drift apart.
 *
 * A fine-grained token can be limited to chosen repositories. One limited to
 * this repository lists only this repository, and the picker says which
 * setting widens it (`NARROW_TOKEN_FIX`) and takes a typed owner/name instead.
 * A typed repository is still read from GitHub before anything is written: a
 * row naming a repository nobody can open would give the plan a section no
 * session could build in.
 *
 * Archiving sets `archived_at`. The row and the plan rows filed under it stay,
 * the section and the project page go, and adding the same repository again
 * puts it back.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isModuleId } from '@/lib/modules';
import { ask, readToken, REPO_KEY } from './github';
import { loadDevProjects, projectFromRow, PROJECT_COLUMNS, type DevProject } from './projects';
import { writeSetUpSteps } from './project-setup';

/** One repository as the picker lists it. */
export type GithubRepository = {
  owner: string;
  name: string;
  /** "owner/name", how GitHub writes it and how the picker shows it. */
  fullName: string;
  description: string | null;
  /** The site the repository says it deploys, when it says one. */
  homepage: string | null;
  defaultBranch: string;
  /** When anything was last pushed, for the order. Null when GitHub did not say. */
  pushedAt: string | null;
  private: boolean;
};

/** What the picker opens on: the repositories, or why there are none. */
export type RepositoryListing = {
  repositories: GithubRepository[];
  /** Why GitHub could not be asked, in a sentence. Null when it answered. */
  error: string | null;
};

/** What adding a repository came to. */
export type AddProjectResult =
  | {
      ok: true;
      project: DevProject;
      restored: boolean;
      /**
       * The set-up step written under the new project (lib/plan/project-setup),
       * or why it was not. Null for a project put back, whose rows are kept.
       */
      setUp: { number: number } | { error: string } | null;
    }
  | { ok: false; error: string };

/** What a database client must offer here: the person's own client, or Dash's. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any>;

/** What to set when the token sees this repository alone, in the words the picker shows. */
export const NARROW_TOKEN_FIX =
  'GITHUB_READ_TOKEN can see only this repository. To pick from the rest, open the token on GitHub (Settings, Developer settings, Fine-grained tokens), set Repository access to All repositories with Metadata: Read, and save. Until then, type the repository below.';

/** The longest description the row holds (dev_projects_description_ck). */
const DESCRIPTION_MAX = 200;
/** The longest id: plan_items.module holds 40 characters. */
const ID_MAX = 40;

/** GitHub's repository object, as far as this file reads it. */
type ApiRepository = {
  name?: unknown;
  full_name?: unknown;
  owner?: { login?: unknown } | null;
  description?: unknown;
  homepage?: unknown;
  default_branch?: unknown;
  pushed_at?: unknown;
  private?: unknown;
  archived?: unknown;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** One repository from GitHub's answer, or null for one missing its name. */
export function repositoryFromApi(raw: ApiRepository): GithubRepository | null {
  const owner = text(raw.owner?.login);
  const name = text(raw.name);
  if (!owner || !name) return null;
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    description: text(raw.description),
    homepage: text(raw.homepage),
    defaultBranch: text(raw.default_branch) ?? 'main',
    pushedAt: text(raw.pushed_at),
    private: raw.private === true,
  };
}

/** Newest pushed first; a repository GitHub gave no time for goes last. */
export function newestPushedFirst(repositories: readonly GithubRepository[]): GithubRepository[] {
  return [...repositories].sort((a, b) => {
    const at = (r: GithubRepository) => (r.pushedAt ? Date.parse(r.pushedAt) || 0 : 0);
    return at(b) - at(a) || a.fullName.localeCompare(b.fullName);
  });
}

/**
 * Whether the token sees no repository but this one: what turns on the
 * notice saying which setting to change. An empty listing counts, since it
 * is the same setting.
 */
export function tokenTooNarrow(repositories: readonly GithubRepository[]): boolean {
  return repositories.every((repo) => repo.fullName.toLowerCase() === REPO_KEY.toLowerCase());
}

/**
 * The repositories the token can see, newest pushed first. Archived ones
 * are left out: nothing is pushed to them, so no step could be built there.
 * Never throws; a refusal comes back as `error`.
 */
export async function listGithubRepositories(input: {
  token?: string | null;
  fetch?: typeof globalThis.fetch;
} = {}): Promise<RepositoryListing> {
  const token = input.token === undefined ? readToken() : input.token;
  if (!token) {
    return { repositories: [], error: 'No GITHUB_READ_TOKEN is set, so your repositories cannot be listed. Type the repository instead.' };
  }
  try {
    const raw = await ask<ApiRepository[]>(
      '/user/repos?sort=pushed&direction=desc&per_page=100',
      token,
      input.fetch ?? globalThis.fetch,
    );
    const repositories = (Array.isArray(raw) ? raw : [])
      .filter((repo) => repo.archived !== true)
      .flatMap((repo) => {
        const one = repositoryFromApi(repo);
        return one ? [one] : [];
      });
    return { repositories: newestPushedFirst(repositories), error: null };
  } catch (error) {
    return { repositories: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** GitHub's rules for an owner and a repository name, as the table's checks hold them. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * A repository as somebody typed it: "owner/name", a github.com link, or a
 * clone address. Null when it is none of those.
 */
export function parseRepositoryName(typed: string): { owner: string; repo: string } | null {
  let value = typed.trim();
  value = value.replace(/^git@github\.com:/i, '');
  value = value.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  value = value.replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!OWNER.test(owner) || !NAME.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/**
 * The id a repository's project is filed under: its name in lower case with
 * anything else turned to hyphens, at most 40 characters, starting with a
 * letter, never a workspace's id and never one already taken (archived
 * projects included, since their plan rows still carry it). A clash gets
 * -2, -3 and so on.
 */
export function projectIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `project-${base}`.replace(/-+$/, '');
  base = base.slice(0, ID_MAX).replace(/-+$/, '');
  const free = (id: string) => !used.has(id) && !isModuleId(id);
  if (free(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const id = `${base.slice(0, ID_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (free(id)) return id;
  }
}

/** The row a repository becomes. */
export function projectRowFor(input: {
  userId: string;
  id: string;
  repository: GithubRepository;
}): Record<string, unknown> {
  const { repository } = input;
  const description = repository.description ?? '';
  const homepage = repository.homepage && /^https?:\/\//i.test(repository.homepage) ? repository.homepage : null;
  return {
    id: input.id,
    user_id: input.userId,
    label: repository.name.slice(0, 80),
    description:
      description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : description,
    owner: repository.owner,
    repo: repository.name,
    branch: repository.defaultBranch,
    url: homepage,
  };
}

const sameRepository = (project: DevProject, owner: string, repo: string) =>
  project.repo.owner.toLowerCase() === owner.toLowerCase() &&
  project.repo.repo.toLowerCase() === repo.toLowerCase();

/** This app's own repository, which the plan's workspaces already are. */
const isThisApp = (owner: string, repo: string) =>
  `${owner}/${repo}`.toLowerCase() === REPO_KEY.toLowerCase();

/** Whether a listed repository is this app's, which the picker leaves out. */
export function isAppRepository(repository: GithubRepository): boolean {
  return isThisApp(repository.owner, repository.name);
}

/**
 * Add a repository as one of the person's projects.
 *
 * One already added is refused, and one archived is put back. Otherwise the
 * repository is read from GitHub, so its default branch, description and
 * homepage fill the row, and the row is written with a fresh id.
 */
export async function addDevProject(input: {
  db: Db;
  userId: string;
  repository: { owner: string; repo: string };
  token?: string | null;
  fetch?: typeof globalThis.fetch;
}): Promise<AddProjectResult> {
  const { owner, repo } = input.repository;
  if (!OWNER.test(owner) || !NAME.test(repo)) {
    return { ok: false, error: `"${owner}/${repo}" is not a GitHub repository name. Write it as owner/name.` };
  }
  if (isThisApp(owner, repo)) {
    return { ok: false, error: `${owner}/${repo} is this app. Its plan is already the workspaces' sections on the plan.` };
  }

  const projects = await loadDevProjects(input.db, input.userId);
  const existing = projects.find((project) => sameRepository(project, owner, repo));
  if (existing && !existing.archivedAt) {
    return { ok: false, error: `${owner}/${repo} is already a project, ${existing.label}.` };
  }
  if (existing) {
    const { data, error } = await input.db
      .from('dev_projects')
      .update({ archived_at: null })
      .eq('user_id', input.userId)
      .eq('id', existing.id)
      .select(PROJECT_COLUMNS);
    if (error) return { ok: false, error: `${existing.label} could not be put back: ${error.message}` };
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    const project = row ? projectFromRow(row) : null;
    return project
      ? { ok: true, project, restored: true, setUp: null }
      : { ok: false, error: `${existing.label} could not be put back.` };
  }

  const token = input.token === undefined ? readToken() : input.token;
  if (!token) {
    return { ok: false, error: `No GITHUB_READ_TOKEN is set, so ${owner}/${repo} cannot be read from GitHub. Set it in Vercel and redeploy.` };
  }
  let repository: GithubRepository | null;
  try {
    repository = repositoryFromApi(
      await ask<ApiRepository>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        token,
        input.fetch ?? globalThis.fetch,
      ),
    );
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    // refusalFor names this app's repository, which is not the one asked about.
    if (/\((403|404)\)/.test(why)) {
      return {
        ok: false,
        error: `GitHub would not show ${owner}/${repo}: there is no such repository, or GITHUB_READ_TOKEN cannot see it. Check the name, or give the token access to it.`,
      };
    }
    return { ok: false, error: `GitHub would not show ${owner}/${repo}. ${why}` };
  }
  if (!repository) return { ok: false, error: `GitHub said nothing about ${owner}/${repo}.` };

  const id = projectIdFor(repository.name, projects.map((project) => project.id));
  const { data, error } = await input.db
    .from('dev_projects')
    .insert(projectRowFor({ userId: input.userId, id, repository }))
    .select(PROJECT_COLUMNS);
  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? `The id ${id} is taken. Rename the other project first, or try again.`
          : `${repository.fullName} could not be added: ${error.message}`,
    };
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  const project = row ? projectFromRow(row) : null;
  if (!project) return { ok: false, error: `${repository.fullName} was added but could not be read back.` };
  // The project stands without its set-up step, so a step that was not
  // written is reported rather than taking the project back out.
  const written = await writeSetUpSteps({ db: input.db, userId: input.userId, project });
  if ('error' in written) console.error(`${project.label}: ${written.error}`);
  return {
    ok: true,
    project,
    restored: false,
    setUp: 'error' in written ? written : { number: written.number },
  };
}

/** Put a project away: off the plan and its page, its rows kept. */
export async function archiveDevProject(input: {
  db: Db;
  userId: string;
  id: string;
}): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const { data, error } = await input.db
    .from('dev_projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('id', input.id)
    .is('archived_at', null)
    .select('id, label');
  if (error) return { ok: false, error: `The project could not be archived: ${error.message}` };
  const row = (Array.isArray(data) ? data[0] : data) as { label?: string } | undefined;
  if (!row) return { ok: false, error: 'That project is already archived or no longer here.' };
  return { ok: true, label: row.label ?? input.id };
}

/**
 * The repository a name Dash was given points at: owner/name as written, or
 * a bare name matched against the listing ("my recipes repo" is "recipes").
 * Null with the reason when none or several match.
 */
export function repositoryByName(
  named: string,
  repositories: readonly GithubRepository[],
): { owner: string; repo: string } | { error: string } {
  const typed = parseRepositoryName(named);
  if (typed) return typed;
  const wanted = named.trim().toLowerCase();
  if (!wanted) return { error: 'Name the repository, as owner/name or its name.' };
  const exact = repositories.filter((repo) => repo.name.toLowerCase() === wanted);
  const matches = exact.length > 0 ? exact : repositories.filter((repo) => repo.name.toLowerCase().includes(wanted));
  if (matches.length === 1) return { owner: matches[0].owner, repo: matches[0].name };
  if (matches.length > 1) {
    return { error: `"${named}" matches ${matches.map((repo) => repo.fullName).join(', ')}. Say which, as owner/name.` };
  }
  return {
    error:
      repositories.length > 0
        ? `No repository GITHUB_READ_TOKEN can see is called "${named}". Say it as owner/name.`
        : `Your repositories could not be listed, so "${named}" cannot be looked up. Say it as owner/name.`,
  };
}

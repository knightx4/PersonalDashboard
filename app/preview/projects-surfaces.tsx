import { ProjectsView, type ProjectRow } from '@/app/dev/projects/projects-view';
import type { GithubRepository, RepositoryListing } from '@/lib/plan/project-add';

/**
 * Dev's Projects page (plan #2553.5), drawn from fixtures for the gallery:
 * the list, each of its hidden parts open, and the empty page.
 */

const ROWS: ProjectRow[] = [
  {
    id: 'website',
    label: 'alexrivera.dev',
    repository: 'alex-rivera/alexrivera-site',
    ci: 'passed',
    open: 4,
    comments: 2,
  },
  {
    id: 'pointtracker',
    label: 'pointtracker',
    repository: 'alex-rivera/pointtracker',
    ci: 'failed',
    open: 0,
    comments: 0,
  },
  {
    id: 'obsidian-vault-maker-for-long-reading-notes',
    label: 'obsidian-vault-maker-for-long-reading-notes',
    repository: 'alex-rivera/obsidian-vault-maker-for-long-reading-notes',
    ci: 'unread',
    open: 12,
    comments: 0,
  },
];

function repo(name: string, over: Partial<GithubRepository> = {}): GithubRepository {
  return {
    owner: 'alex-rivera',
    name,
    fullName: `alex-rivera/${name}`,
    description: null,
    homepage: null,
    defaultBranch: 'main',
    pushedAt: null,
    private: false,
    ...over,
  };
}

const LISTING: RepositoryListing = {
  error: null,
  repositories: [
    repo('PersonalDashboard', { description: 'The dashboard this is' }),
    repo('alexrivera-site', { private: true, description: 'The personal website' }),
    repo('interactive-islm', { description: 'An interactive IS-LM model for the macro course, with sliders for every curve' }),
    repo('obsidian-vault-maker-for-long-reading-notes', { private: true }),
    repo('pointtracker', { description: 'Points for the house chores' }),
    repo('sckwebsite'),
  ],
};

const NARROW: RepositoryListing = { error: null, repositories: [repo('PersonalDashboard')] };

export function ProjectsSurface() {
  return <ProjectsView rows={ROWS} />;
}

export function ProjectsPickerSurface() {
  return <ProjectsView rows={ROWS} open={{ part: 'picker', listing: LISTING }} />;
}

export function ProjectsSearchEmptySurface() {
  return <ProjectsView rows={ROWS} open={{ part: 'picker', listing: LISTING, query: 'recipes' }} />;
}

export function ProjectsNarrowTokenSurface() {
  return <ProjectsView rows={ROWS} open={{ part: 'picker', listing: NARROW }} />;
}

export function ProjectsAddErrorSurface() {
  return (
    <ProjectsView
      rows={ROWS}
      open={{
        part: 'picker',
        listing: LISTING,
        error:
          'GitHub would not show alex-rivera/recipes: there is no such repository, or GITHUB_READ_TOKEN cannot see it. Check the name, or give the token access to it.',
      }}
    />
  );
}

export function ProjectsArchiveSurface() {
  return <ProjectsView rows={ROWS} open={{ part: 'archive', id: 'pointtracker' }} />;
}

/** Comment marks on more than one row, the hidden part rows carry once talked about. */
export function ProjectsCommentsSurface() {
  return (
    <ProjectsView
      rows={ROWS.map((row, i) => ({ ...row, comments: [2, 1, 14][i] ?? 0 }))}
    />
  );
}

export function ProjectsEmptySurface() {
  return <ProjectsView rows={[]} />;
}

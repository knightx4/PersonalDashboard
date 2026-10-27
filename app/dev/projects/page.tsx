import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { activeProjects, loadDevProjects, type DevProject } from '@/lib/plan/projects';
import { threadRef } from '@/lib/thread/subjects';
import { loadTableThreads } from '@/lib/thread/store';
import { ProjectsView, type ProjectCi, type ProjectRow } from './projects-view';

export const metadata = { title: 'Projects' };

/** Plan rows that are still open: neither finished nor put aside. */
const CLOSED = ['done', 'dropped'];

/**
 * Dev's Projects page (plan #2553.5). Reads the account's active projects,
 * the newest CI reading for each one's repository (plan_main_checks, keyed
 * owner/name), the open steps filed under each, and its thread's length,
 * then hands them to ProjectsView. A reading that fails draws its part as
 * unknown rather than failing the page.
 */
export default async function DevProjectsPage() {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });
  const projects = activeProjects(await loadDevProjects(supabase, user.id));
  const rows = await projectRows(supabase, user.id, projects);
  return <ProjectsView rows={rows} />;
}

async function projectRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projects: readonly DevProject[],
): Promise<ProjectRow[]> {
  if (projects.length === 0) return [];
  const keys = projects.map((project) => `${project.repo.owner}/${project.repo.repo}`);
  const [checks, steps, threads] = await Promise.all([
    supabase.from('plan_main_checks').select('repo, conclusion').in('repo', keys),
    supabase
      .from('plan_items')
      .select('module')
      .eq('user_id', userId)
      .in(
        'module',
        projects.map((project) => project.id),
      )
      .not('parent_id', 'is', null)
      .not('status', 'in', `(${CLOSED.join(',')})`),
    loadTableThreads(supabase, 'public.dev_projects', { userId }).catch(() => new Map()),
  ]);

  const conclusion = new Map<string, string | null>(
    ((checks.data ?? []) as { repo: string; conclusion: string | null }[]).map((row) => [
      row.repo.toLowerCase(),
      row.conclusion,
    ]),
  );
  const open = new Map<string, number>();
  for (const row of (steps.data ?? []) as { module: string }[]) {
    open.set(row.module, (open.get(row.module) ?? 0) + 1);
  }

  return projects.map((project, i) => ({
    id: project.id,
    label: project.label,
    repository: keys[i],
    ci: ciOf(conclusion.has(keys[i].toLowerCase()) ? conclusion.get(keys[i].toLowerCase()) ?? null : undefined),
    open: open.get(project.id) ?? 0,
    comments: threads.get(threadRef('project', project.id))?.length ?? 0,
  }));
}

/** A stored conclusion as the row's word; undefined is a repository never read. */
function ciOf(conclusion: string | null | undefined): ProjectCi {
  if (conclusion === undefined || conclusion === null) return 'unread';
  if (conclusion === 'passed' || conclusion === 'failed' || conclusion === 'running' || conclusion === 'none') {
    return conclusion;
  }
  return 'unread';
}

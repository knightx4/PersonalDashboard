import { loadProjectLive } from '@/lib/plan/project-live-read';
import type { DevProject } from '@/lib/plan/projects';
import { ProjectLiveCard } from './project-live';

/**
 * The project page's live card, read from GitHub and Vercel (plan #2800.6).
 * Rendered inside a Suspense boundary, so the plan below it does not wait on
 * either service; `ProjectLiveLoading` stands in until the reading lands.
 */
export async function ProjectLiveSection({ project, now }: { project: DevProject; now: number }) {
  const live = await loadProjectLive(project.repo);
  return <ProjectLiveCard live={live} siteUrl={project.url} now={now} />;
}

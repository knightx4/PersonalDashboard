import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { activeProjects, projectById } from '@/lib/plan/projects';
import { loadProjectsForRequest } from '@/lib/plan/request-plan';
import { renderPlanPage } from '../../plan/plan-page';

/**
 * A project's page in Dev: its plan, drawn by the plan page with only its
 * section. See lib/plan/projects for what a project is; the projects are the
 * account's rows in dev_projects, and an archived one has no page.
 */
async function projectFor(id: string) {
  const user = await requireUser();
  return projectById(activeProjects(await loadProjectsForRequest(user.id)), id);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: (await projectFor(id))?.label ?? 'Module' };
}

export default async function DevProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[]; q?: string | string[] }>;
}) {
  const { id } = await params;
  const project = await projectFor(id);
  if (!project) notFound();
  return renderPlanPage({ searchParams, project });
}

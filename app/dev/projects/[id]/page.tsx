import { notFound } from 'next/navigation';
import { projectById } from '@/lib/plan/projects';
import { renderPlanPage } from '../../plan/plan-page';

/**
 * A project's page in Dev: its plan, drawn by the plan page with only its
 * section. See lib/plan/projects for what a project is.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: projectById(id)?.label ?? 'Project' };
}

export default async function DevProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[]; q?: string | string[] }>;
}) {
  const { id } = await params;
  const project = projectById(id);
  if (!project) notFound();
  return renderPlanPage({ searchParams, project });
}

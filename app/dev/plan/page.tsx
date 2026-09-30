import { renderPlanPage } from './plan-page';

export const metadata = { title: 'Plan' };

export default async function DevPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; q?: string | string[] }>;
}) {
  return renderPlanPage({ searchParams, project: null });
}

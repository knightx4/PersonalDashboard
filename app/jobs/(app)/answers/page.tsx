import { redirect } from 'next/navigation';
import { materialHref } from '@/lib/jobs/material';

/**
 * The question bank moved into Material (plan #1592). Old links and bookmarks
 * land there, on the same kind filter they named.
 */
export default async function AnswersPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  redirect(materialHref('answers', kind ?? null));
}

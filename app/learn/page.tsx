import { redirect } from 'next/navigation';
import { practiceHref } from '@/lib/learn/flow/href';

/**
 * Opening Learn lands on Now, the first tab (plan #1486). It landed on Home
 * from plan #1313 until then, and on Learn now before that. Nothing is
 * rendered here; every link to /learn is sent on.
 *
 * Two kinds of old link carry a query and go somewhere more specific. `?track=`
 * is a Practice Flow focused on one track, from when the flow was /learn
 * (plan #773 to #805), so it goes to Now's practice questions on that track. `?q=` is a search
 * of the reading lists, from before that, when /learn was the lists.
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; track?: string | string[] }>;
}) {
  const { q, track } = await searchParams;
  if (typeof track === 'string') redirect(practiceHref({ track }));
  if (q !== undefined) redirect(`/learn/lists?q=${encodeURIComponent(q)}`);
  redirect('/learn/now');
}

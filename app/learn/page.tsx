import { redirect } from 'next/navigation';

/**
 * Opening Learn lands on Home, the first tab (plan #1313). It landed on Learn
 * now from plan #805 until then. Nothing is rendered here; every link to
 * /learn is sent on.
 *
 * Two kinds of old link carry a query and go somewhere more specific. `?track=`
 * is a Practice Flow focused on one track, from when the flow was /learn
 * (plan #773 to #805), so it goes to the flow at /learn/flow. `?q=` is a search
 * of the reading lists, from before that, when /learn was the lists.
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; track?: string | string[] }>;
}) {
  const { q, track } = await searchParams;
  if (typeof track === 'string') redirect(`/learn/flow?track=${encodeURIComponent(track)}`);
  if (q !== undefined) redirect(`/learn/lists?q=${encodeURIComponent(q)}`);
  redirect('/learn/home');
}

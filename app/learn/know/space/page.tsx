import { redirect } from 'next/navigation';

/**
 * Idea Space was first reached from Subjects at this address (plan #1857) and
 * became a tab of its own at /learn/space. A link kept from before is sent on,
 * with its layout, colour and open idea.
 */
export default async function IdeaSpaceMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      search.append(key, one);
    }
  }
  const query = search.toString();
  redirect(query ? `/learn/space?${query}` : '/learn/space');
}

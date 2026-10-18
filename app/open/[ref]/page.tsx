import { redirect } from 'next/navigation';
import { requestAskDb } from '@/lib/ask/clients';
import { requireUser } from '@/lib/auth/server';
import { readRowsWith, refTitles } from '@/lib/core/refs';
import { NoLongerThere } from '@/components/shell/no-longer-there';

export const metadata = { title: 'Open' };

/**
 * A ref opened by name (plan #1449): reads the row on the person's session
 * and goes on to its page. A row that has gone, or is not theirs, is shown as
 * no longer there, and links nowhere. A `?tab=` given here is carried on to
 * the page, so a row read on one tab of another row's page opens on it.
 */
export default async function OpenRefPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ ref: encoded }, { tab }] = await Promise.all([params, searchParams]);
  await requireUser();
  const ref = decodeURIComponent(encoded);
  const target = (await refTitles([ref], readRowsWith(requestAskDb()))).get(ref);
  if (target && !target.missing && target.href) {
    redirect(typeof tab === 'string' && tab ? withTab(target.href, tab) : target.href);
  }

  return <NoLongerThere />;
}

function withTab(href: string, tab: string): string {
  const hash = href.indexOf('#');
  const base = hash < 0 ? href : href.slice(0, hash);
  const rest = hash < 0 ? '' : href.slice(hash);
  return `${base}${base.includes('?') ? '&' : '?'}tab=${encodeURIComponent(tab)}${rest}`;
}

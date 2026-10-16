import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { toRef } from '@/lib/core/refs';
import { rowSubject } from '@/lib/core/subject';
import { zoneDay } from '@/lib/core/when';
import { createLearnClient } from '@/lib/learn/auth/server';
import { lensDetail } from '@/lib/learn/levels/lenses';
import { loadLens, loadTopicNames } from '@/lib/learn/levels/lens-store';
import { readCells } from '@/lib/learn/levels/model';
import { loadTopicMap } from '@/lib/learn/levels/store';
import { loadThread } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import { LensView } from './lens-view';

export const dynamic = 'force-dynamic';

/**
 * One lens (plan #2138.7): a subject or learning goal as topics to targets.
 * Progress, the bands and the fringe are worked out here from the whole map
 * on every visit (rule R4). Somebody else's lens reads as no row, so it is a
 * 404. `?edit=1` opens the targets as a form.
 */
export default async function LensPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const [learn, core, settings] = await Promise.all([createLearnClient(), createClient(), loadAccountSettings(user.id)]);

  const found = await loadLens(learn, id);
  if (!found) notFound();

  const [map, names, comments, path] = await Promise.all([
    loadTopicMap(learn),
    loadTopicNames(learn),
    loadThread(core, threadRef('lens', id), { userId: user.id }).catch(() => []),
    rowSubject(toRef('learn.lenses', id)),
  ]);
  const now = new Date().getTime();
  const detail = lensDetail(found.lens, map, readCells(map), names, {
    today: zoneDay(now, settings.timezone),
    dayOf: (at) => zoneDay(at, settings.timezone),
  });

  return (
    <LensView
      id={id}
      name={found.lens.name}
      source={found.source}
      createdAt={found.lens.createdAt}
      detail={detail}
      comments={comments}
      path={path}
      editing={edit === '1'}
      timezone={settings.timezone}
      now={now}
    />
  );
}

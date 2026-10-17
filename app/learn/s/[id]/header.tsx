import Link from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { nowHref, practiceHref, subjectClipsHref } from '@/lib/learn/flow/href';
import { settledCount, type SubjectCounts } from '@/lib/learn/graph/model';
import { heldLine, type LensHeld } from '@/lib/learn/levels/lenses';

/**
 * The top of a subject's page (plan #2307.1). How much of its territory you
 * hold comes from the subject's lens, as levels held by a test and levels held
 * by inference, so a prepared subject with topics and no claims still says
 * where you stand. The claims graph's count follows when there is one.
 */
export function subjectDescription(held: LensHeld | null, counts: SubjectCounts): string {
  const lens = held ? heldLine(held) : null;
  const claims =
    counts.total === 0
      ? null
      : `${settledCount(counts)} of ${counts.total} known${
          counts.misconception > 0 ? ` · ${counts.misconception} mixed up` : ''
        }`;
  return [lens, claims].filter((part) => part !== null).join(' · ') || 'Nothing in this subject yet.';
}

/**
 * The presses. Ask me about this and Practice this show on every subject:
 * practice is scoped to the subject's lens (the flow reads it, so topics with
 * no claims behind them are asked about), and the probe says so itself when
 * there are no claims to ask about.
 */
export function SubjectPresses({
  id,
  lensId,
  owner,
}: {
  id: string;
  lensId: string | null;
  owner: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
      {/* Now with only this subject's cards (plan #1698). Its empty
          state says when there are none, so it shows on every subject. */}
      <Link href={nowHref(id)} className={buttonVariants({ variant: 'secondary' })}>
        Now
      </Link>
      {lensId && (
        <Link href={`/learn/lens/${lensId}`} className={buttonVariants({ variant: 'secondary' })}>
          Levels
        </Link>
      )}
      {/* The clips that serve this subject (plan #1697). The owner's alone,
          like Videos, since they are cut from the owner's YouTube library. */}
      {owner && (
        <Link href={subjectClipsHref(id)} className={buttonVariants({ variant: 'secondary' })}>
          Clips
        </Link>
      )}
      <Link href={`/learn/s/${id}/probe`} className={buttonVariants({ variant: 'secondary' })}>
        Ask me about this
      </Link>
      {/* The flow limited to this subject (plan #779), left again with All
          tracks on the flow itself. */}
      <Link href={practiceHref({ track: id })} className={cn(buttonVariants({ variant: 'primary' }), 'max-sm:order-first max-sm:w-full')}>
        Practice this
      </Link>
    </div>
  );
}

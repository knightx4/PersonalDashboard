import { Messaging, MessagingThread } from '@/components/patterns/messaging';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The People tab while it is read (plan #2748.6): the list's pane with its
 * heading, the search box and rows of round marks and two lines, and the
 * thread in the frame it loads into: the bar with a mark and a name, bubbles
 * on either side under it, and the box at the foot, so only the words change
 * when the thread lands. `thread` draws a thread loading in place of the
 * list on a phone.
 */

/** A bubble's round, as MessageBubble draws it. */
const BUBBLE = 'rounded-[1.125rem]'; /* ui-ok: a chat bubble's round, as MessageBubble */

export function PeopleSkeleton({ thread = false }: { thread?: boolean }) {
  return (
    <Messaging
      label="People"
      open={thread}
      list={
        <div className="flex flex-col px-4 pt-4 pb-5" aria-busy>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-3 h-(--control-h) w-full rounded-control" />
          <ul className="mt-3 flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-start gap-2.5">
                <Skeleton className="size-11 shrink-0 rounded-full" />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3.5 w-4/5" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <MessagingThread
        name={<Skeleton className="h-4 w-32" />}
        avatar={<Skeleton className="size-8 shrink-0 rounded-full" />}
        back={{ href: '/chat', label: 'People' }}
        box={<Skeleton className="h-(--control-h) w-full rounded-pill" />}
      >
        <div className="flex flex-col gap-2" aria-busy>
          <Skeleton className={`w-3/5 self-start py-4 ${BUBBLE}`} />
          <Skeleton className={`w-2/5 self-start py-4 ${BUBBLE}`} />
          <Skeleton className={`mt-3 w-1/2 self-end py-4 ${BUBBLE}`} />
          <Skeleton className={`mt-3 h-14 w-3/4 self-start ${BUBBLE}`} />
        </div>
      </MessagingThread>
    </Messaging>
  );
}

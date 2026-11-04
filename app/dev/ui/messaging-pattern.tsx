import { ArrowUp } from 'lucide-react';
import {
  Messaging,
  MessageBubble,
  MessageDay,
  MessageGroup,
  MessagingThread,
  PersonMark,
} from '@/components/patterns/messaging';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

/**
 * The messaging pattern on /dev/ui (plan #2748.13): people on the left and an
 * open thread on the right, drawn with made-up people. `open` says whether a
 * phone shows the thread or the list; the laptop shows both either way.
 */

type Person = { name: string; initials: string; last: string; time: string; unread?: boolean };

const PEOPLE: readonly Person[] = [
  { name: 'Ben Franklin', initials: 'BF', last: "What's actually in the way?", time: '7:12 AM' },
  { name: 'Seneca', initials: 'S', last: "You spent Saturday planning a week you then didn't follow. Plans are cheap; the day is not.", time: 'Sun', unread: true },
  { name: 'Jerwyn the Elder', initials: 'JE', last: 'Tell me the one part you keep replaying.', time: 'Yesterday' },
  { name: 'Richard Feynman', initials: 'RF', last: 'Then explain to me what you did get. Sloppy is fine.', time: 'Oct 30' },
  { name: 'Dr Alexandrina Featherstonehaugh-Wetherby', initials: 'AF', last: 'Your Ironworks Gym membership renewed at $260. You have checked in twice since August.', time: 'Oct 29' },
];

function PeopleList() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="px-4 pt-4 pb-2 font-display text-title font-semibold tracking-tight text-ink">People</h2>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {PEOPLE.map((p, i) => (
          <li key={p.name}>
            <a
              href="#"
              aria-current={i === 0 ? 'true' : undefined}
              className={cn(
                'grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-control px-2 py-2 hover:bg-sunken',
                i === 0 && 'bg-accent-tint',
              )}
            >
              <PersonMark initials={p.initials} />
              <span className="min-w-0">
                <span className={cn('block truncate text-body text-ink', p.unread ? 'font-semibold' : 'font-medium')}>{p.name}</span>
                <span className={cn('line-clamp-2 text-ui', p.unread ? 'text-ink' : 'text-ink-muted')}>{p.last}</span>
              </span>
              <span className="flex flex-col items-end gap-1.5 pt-0.5">
                <span className="text-small tabular-nums text-ink-muted">{p.time}</span>
                {p.unread && <span aria-label="Unread" className="size-2 rounded-full bg-accent" />}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Box() {
  return (
    <form className="flex items-center gap-2">
      <Input aria-label="Message" placeholder="Message" className="min-h-11 flex-1" />
      <Tooltip label="Send">
        <Button type="button" size="sm" aria-label="Send">
          <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </Tooltip>
    </form>
  );
}

export function MessagingPatternSurface({ open = true }: { open?: boolean }) {
  return (
    <Messaging label="People" list={<PeopleList />} open={open}>
      <MessagingThread
        name="Ben Franklin"
        detail="Money · usually replies right away"
        avatar={<PersonMark initials="BF" size="sm" />}
        back={{ href: '#', label: 'People' }}
        box={<Box />}
      >
        <MessageDay>Tuesday</MessageDay>
        <MessageGroup from="you">
          <MessageBubble from="you">{`I keep going back and forth on whether to take the Northwind call`}</MessageBubble>
        </MessageGroup>
        <MessageGroup from="them">
          <MessageBubble from="them">{`Then take it. A call costs you an hour and commits you to nothing.`}</MessageBubble>
          <MessageBubble from="them">{`Most men regret the doors they didn't knock on, not the ones that opened onto a dull room.`}</MessageBubble>
        </MessageGroup>
        <MessageDay>Today</MessageDay>
        <MessageGroup from="them">
          <MessageBubble from="them">{`Morning. You put the Northwind application off again yesterday. That's the third time this week.`}</MessageBubble>
          <MessageBubble from="them">{`What's actually in the way?`}</MessageBubble>
        </MessageGroup>
      </MessagingThread>
    </Messaging>
  );
}

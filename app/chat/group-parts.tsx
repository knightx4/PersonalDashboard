import { cn } from '@/lib/cn';
import { personInitials } from '@/lib/you/chat-threads-model';
import { reactionSummary, type GroupMember, type Reacted } from '@/lib/you/group-chats-model';

/**
 * The pieces a group chat draws that a direct one does not (plan #2879.1.3):
 * its mark, two members' marks overlapping in the space one takes, and the
 * reactions the bots tapped back on a message.
 */

/** A group's round mark: its first two members' colours, one over the other, the front one with its initial. */
export function GroupMark({ members, size = 'md' }: { members: readonly Pick<GroupMember, 'name' | 'colour'>[]; size?: 'sm' | 'md' }) {
  const shown = members.slice(0, 2);
  return (
    <span aria-hidden className={cn('relative block shrink-0', size === 'md' ? 'size-11' : 'size-8')}>
      {shown.map((m, i) => (
        <span
          key={`${m.name}-${i}`}
          style={{ backgroundColor: m.colour }}
          className={cn(
            'absolute flex items-center justify-center rounded-full font-display font-semibold text-white ring-2 ring-surface',
            size === 'md' ? 'size-8 text-small' : 'size-6 text-small',
            shown.length === 1 ? 'inset-0 m-auto' : i === 0 ? 'top-0 left-0' : 'right-0 bottom-0',
          )}
        >
          {/* The mark behind is mostly covered, so only the front one carries a letter. */}
          {(shown.length === 1 || i === 1) && personInitials(m.name).slice(0, 1)}
        </span>
      ))}
    </span>
  );
}

/** The reactions on one message: a small pill of each glyph and how many gave it, named for a screen reader. */
export function Reactions({ list, members, from }: { list: readonly Reacted[]; members: readonly GroupMember[]; from: 'you' | 'them' }) {
  const summary = reactionSummary(list, members);
  if (summary.length === 0) return null;
  return (
    <span className={cn('-mt-1.5 flex gap-1', from === 'you' ? 'self-end pr-2' : 'self-start pl-2')}>
      {summary.map((r) => (
        <span
          key={r.reaction}
          role="img"
          aria-label={`${r.who.join(', ')} reacted ${r.reaction.replace('_', ' ')}`}
          title={r.who.join(', ')}
          className="inline-flex items-center gap-0.5 rounded-pill bg-surface px-1.5 py-0.5 text-small text-ink-muted ring-1 ring-border" /* ui-ok: a reaction pill sitting on a bubble's edge, as a texting app draws a tap back */
        >
          <span aria-hidden>{r.glyph}</span>
          {r.who.length > 1 && <span className="tabular">{r.who.length}</span>}
        </span>
      ))}
    </span>
  );
}

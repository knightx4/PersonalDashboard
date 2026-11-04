import { cn } from '@/lib/cn';
import { AdvisorAvatar } from './advisor-avatar';

/**
 * A mentor's mark on the Council: their illustrated avatar (plan #2581.3), the
 * one mark an advisor has wherever they appear, or their initials in the same
 * disc where the page has not drawn its sprite. `size` is the disc's: small
 * beside a name in a line, large at the head of a tile or a page.
 */
export function MentorMark({
  mentorKey,
  name,
  size = 'md',
  className,
}: {
  mentorKey: string;
  name: string;
  kind?: 'seat' | 'guest';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <AdvisorAvatar
      advisorKey={mentorKey}
      name={name}
      decorative
      size={size === 'sm' ? 'sm' : 'md'}
      className={cn(size === 'lg' && 'size-12 text-ui', className)}
    />
  );
}

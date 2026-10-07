import Link from 'next/link';
import { Clapperboard } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { SectionFold } from '@/components/ui/disclosure';
import type { PlayerClip } from '@/lib/learn/clips/stream';
import { ClipStream } from '@/app/learn/clips/clip-stream';
import { ClipsEmpty } from '@/app/learn/clips/empty';

/**
 * Clips as a section of Videos (plan #1488): short clips cut from your
 * videos, played one after another (plan #1400). They were a tab of their own
 * until then; /learn/clips now redirects here with `?open=clips`, which opens
 * the fold and starts the player.
 *
 * The player is only mounted when the URL asks for it. The page opening is
 * the session the picker counts two clips a video against, so a visit to the
 * list should not start one.
 */

/** Where the old Clips tab, and the Watch as clips button, now land. */
export const CLIPS_HREF = '/learn/videos?open=clips#clips';

export function ClipsSection({
  progress,
  player,
}: {
  /** What is cut, what is left and when the next batch comes. */
  progress: string;
  /** The clips to play, when the player is open. */
  player: { clips: PlayerClip[] } | null;
}) {
  return (
    <div id="clips" className="mt-8 scroll-mt-6">
      <SectionFold title="Clips" defaultOpen={player !== null}>
        <p className="text-small tabular-nums text-ink-muted">{progress}</p>
        {player === null ? (
          <div>
            <Link href={CLIPS_HREF} className={buttonVariants({ variant: 'secondary' })}>
              <Clapperboard className="size-4" strokeWidth={1.75} aria-hidden />
              Play clips
            </Link>
          </div>
        ) : player.clips.length === 0 ? (
          <ClipsEmpty />
        ) : (
          <ClipStream initial={player.clips} />
        )}
      </SectionFold>
    </div>
  );
}

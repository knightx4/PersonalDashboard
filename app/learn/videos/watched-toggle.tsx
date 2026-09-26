import { setWatchedAction } from './actions';
import { WatchedButton } from './watched-button';

/**
 * The Watched mark, as the button that changes it. A plain form posting to a
 * server action, so it works before JavaScript does (law 6); pressing it again
 * takes the mark off.
 */
export function WatchedToggle({ videoId, watched }: { videoId: string; watched: boolean }) {
  return (
    <form action={setWatchedAction}>
      <input type="hidden" name="videoId" value={videoId} />
      <input type="hidden" name="watched" value={watched ? '0' : '1'} />
      <WatchedButton watched={watched} />
    </form>
  );
}

import { redirect } from 'next/navigation';
import { YOUTUBE_HREF } from '@/app/learn/videos/library-section';

/**
 * The YouTube library was its own tab here until plan #1488 made it a section
 * of Videos. Nothing is rendered; a link to the old route opens that section.
 * A channel, a playlist and a video keep their routes under /learn/youtube/.
 */
export default function YouTubeRedirect() {
  redirect(YOUTUBE_HREF);
}

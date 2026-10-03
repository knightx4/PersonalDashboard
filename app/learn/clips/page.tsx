import { redirect } from 'next/navigation';
import { CLIPS_HREF } from '@/app/learn/videos/clips-section';

/**
 * Clips was its own tab here until plan #1488 made it a section of Videos.
 * Nothing is rendered; a link to the old route opens that section and starts
 * the player. The player and its actions stay in this folder.
 */
export default function ClipsRedirect() {
  redirect(CLIPS_HREF);
}

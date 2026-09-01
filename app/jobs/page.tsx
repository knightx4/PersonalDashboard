import { redirect } from 'next/navigation';

/**
 * `/jobs` lands on the week, not the board.
 *
 * The board answers "what is going on", which after six months is three
 * hundred rows and mostly history. The week answers "what do I do", which is
 * the question you actually arrive with.
 */
export default function JobsIndex() {
  redirect('/jobs/today');
}

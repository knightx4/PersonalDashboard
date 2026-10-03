import { redirect } from 'next/navigation';
import { QUIZZES_HREF } from '@/app/learn/know/quizzes';

/**
 * Quizzes was its own tab here until plan #1487 made it a section of
 * Subjects. Nothing is rendered; a link to the old route opens that section.
 * One quiz, a new quiz and the screen you answer one on keep their routes
 * under /learn/quiz/.
 */
export default function QuizzesRedirect() {
  redirect(QUIZZES_HREF);
}

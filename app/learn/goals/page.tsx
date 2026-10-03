import { redirect } from 'next/navigation';
import { loadLearnAreaHref } from '@/lib/goals/learn-area';

export const dynamic = 'force-dynamic';

/**
 * Learn's Goals tab (plan #897) went when the learning goals became goals in
 * a Learn area on /goals (plan #1490, #1491). Nothing is rendered; every link
 * here is sent on to that area. How well you want to know a goal and its
 * plan and practice links are on the goal's own page, and the Level 3 goal is
 * one press on Subjects.
 */
export default async function LearnGoalsRedirect() {
  redirect(await loadLearnAreaHref());
}

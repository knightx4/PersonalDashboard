import { redirect } from 'next/navigation';

/**
 * Learn's Home tab (plan #1310) was folded into Now by plan #1486: what was
 * waiting is the strip at the top of Now, and each learning goal's plan is on
 * its subject's page. Nothing is rendered; every link here is sent on.
 */
export default function LearnHomeRedirect() {
  redirect('/learn/now');
}

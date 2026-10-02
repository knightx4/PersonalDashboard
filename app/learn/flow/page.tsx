import { redirect } from 'next/navigation';
import { firstParam, practiceHref } from '@/lib/learn/flow/href';

/**
 * Practice Flow was its own tab here from plan #805 until plan #1486 folded it
 * into Now as the Practice only switch. Nothing is rendered; a link to the old
 * route goes to the switch with its track, goal or filter kept. The questions
 * themselves are drawn by `./practice.tsx`, and the actions they post to stay
 * in `./actions.ts`.
 */
export default async function PracticeFlowRedirect({
  searchParams,
}: {
  searchParams: Promise<{ track?: string | string[]; only?: string | string[]; goal?: string | string[] }>;
}) {
  const { track, only, goal } = await searchParams;
  redirect(practiceHref({ track: firstParam(track), goal: firstParam(goal), only: firstParam(only) }));
}

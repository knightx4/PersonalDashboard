import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { loadRunnerSlots } from '@/lib/plan/runner-slots-load';

export const dynamic = 'force-dynamic';

/**
 * The runner's four slots, for the four Dashes on the status line.
 *
 * Asked for from the browser after the page has drawn rather than read in the
 * shell, because it is the plan page's whole read and the shell is on every
 * page. Only the owner has a runner; anyone else gets no slots.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!(await isOwner({ user }))) return NextResponse.json({ slots: [] });

  try {
    return NextResponse.json({ slots: await loadRunnerSlots(user.id) });
  } catch {
    // A status line that can take a page down should not exist; no slots, no Dashes.
    return NextResponse.json({ slots: [] });
  }
}

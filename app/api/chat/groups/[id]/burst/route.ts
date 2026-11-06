import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth/server';
import { continueBurstInRequest } from '@/lib/you/group-burst-request';

export const dynamic = 'force-dynamic';

/**
 * Carry a group's burst on (plan #2879.1.2). The request running a burst
 * posts here, with the person's own cookie, when its time is nearly out;
 * this one takes the lease it still holds and goes on from `round`. The caps
 * are counted from the thread, so a chained burst cannot exceed them.
 */
export const maxDuration = 300;

const body = z.object({ round: z.number().int().min(0).max(10) });
const id = z.string().uuid();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const chatId = id.safeParse((await params).id);
  if (!chatId.success) return NextResponse.json({ error: 'That group is not there.' }, { status: 404 });
  let parsed: z.infer<typeof body>;
  try {
    const checked = body.safeParse(await request.json());
    if (!checked.success) return NextResponse.json({ error: 'That burst cannot go on.' }, { status: 400 });
    parsed = checked.data;
  } catch {
    return NextResponse.json({ error: 'That burst cannot go on.' }, { status: 400 });
  }
  await continueBurstInRequest(user.id, chatId.data, parsed.round, {
    origin: new URL(request.url).origin,
    cookie: request.headers.get('cookie'),
  });
  return NextResponse.json({ ok: true });
}

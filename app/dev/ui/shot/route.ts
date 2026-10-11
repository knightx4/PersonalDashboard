import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { ownsShotPath } from '@/lib/plan/screen-change';
import { UI_SHOTS_BUCKET } from '@/lib/preview/ui-checks';

/**
 * Open one design check shot (plan #1541). The before and after pictures on
 * a plan step and its changelog line link here with the shot's path in the
 * private `ui-shots` bucket, and this signs a one-minute link to it on your
 * session. The path has to be in your own folder, and the bucket's read
 * policy (migration 0173) refuses anything else as well.
 */
const SIGNED_FOR_SECONDS = 60;

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!ownsShotPath(user.id, path)) return new NextResponse('No such picture.', { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(UI_SHOTS_BUCKET)
    .createSignedUrl(path, SIGNED_FOR_SECONDS);
  if (error || !data) return new NextResponse('No such picture.', { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  // The redirect names a link that expires, so no cache may keep it.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

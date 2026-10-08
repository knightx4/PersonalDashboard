import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { isPictureId, PICTURE_POLICY } from '@/lib/plan/pictures';

/**
 * One drawing on a plan row, as an image (migration 0189). The opened row
 * loads it with an img tag, which is what keeps any script in the SVG from
 * running; the policy header refuses one when the link is opened on its own.
 * Row level security limits the read to your own pictures.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!isPictureId(id)) return new NextResponse('No such picture.', { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plan_item_pictures')
    .select('svg')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data) return new NextResponse('No such picture.', { status: 404 });

  return new NextResponse(data.svg as string, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Security-Policy': PICTURE_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

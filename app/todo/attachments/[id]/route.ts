import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { signedFileUrl } from '@/lib/todo/attachments/store';

/**
 * Open one of the files attached to a task or an event. The bucket is private,
 * so a link on the page points here and this signs a short-lived address on
 * the person's own session: the row is read through RLS and the bucket only
 * signs inside their own folder, so someone else's id finds nothing twice
 * over. Signed on each request so a page left open still works and nothing
 * signed is written into it. `?download=1` saves it instead of showing it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse('No such attachment.', { status: 404 });

  const url = await signedFileUrl(id, request.nextUrl.searchParams.get('download') === '1');
  if (!url) return new NextResponse('No such attachment.', { status: 404 });

  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

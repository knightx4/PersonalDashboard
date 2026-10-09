import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { ATTACHMENTS_BUCKET, ownsAttachmentPath } from '@/lib/attachments/rules';

/**
 * Open a file added to a note, a todo or a question (plan #1712). The
 * attachments bucket is private, so a thumbnail or a chip points here with
 * the core.attachments row's id, and this signs a short link to the copy on
 * your session. The row is read through RLS and the bucket's policy only
 * lets you sign inside your own folder, so somebody else's id finds nothing
 * twice over.
 *
 * Signed on each request rather than when the page is drawn, so a page left
 * open still loads and nothing signed is written into it. Five minutes is
 * long enough for a large PDF to finish loading after the redirect.
 */
const SIGNED_FOR_SECONDS = 5 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse('No such file.', { status: 404 });

  const core = await createCoreClient();
  const { data: row } = await core.from('attachments').select('path').eq('id', id).maybeSingle();

  const path = (row as { path: string } | null)?.path;
  if (!path || !ownsAttachmentPath(user.id, path)) {
    return new NextResponse('No such file.', { status: 404 });
  }

  const { data, error } = await core.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_FOR_SECONDS);
  if (error || !data) return new NextResponse('No such file.', { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  // The redirect names a link that expires, so no cache may keep it.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

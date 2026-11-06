import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PAGE_VIEW_HEADERS, parseVersion } from '@/lib/files/files';
import { loadFile, loadVersionBody } from '@/lib/files/store';

/**
 * A page a bot had made (plan #2997): an html file's body, served as the page
 * itself under PAGE_VIEW_HEADERS, so it runs in a sandbox with no origin of
 * the app's and no way to reach anything outside itself. Its file page frames
 * it; a link here opens it full screen. `?v=2` serves version 2.
 *
 * The row is read through RLS on the person's own session, so somebody
 * else's id finds nothing. A markdown file has no page here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): NextResponse {
  return new NextResponse('No such page.', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const { fileId } = await params;
  if (!UUID.test(fileId)) return notFound();

  const core = await createCoreClient();
  const file = await loadFile(core, fileId).catch(() => null);
  if (!file || file.format !== 'html') return notFound();

  const version = parseVersion(request.nextUrl.searchParams.get('v') ?? undefined);
  const older = version !== null && version !== file.version ? await loadVersionBody(core, fileId, version).catch(() => null) : null;
  if (version !== null && version !== file.version && !older) return notFound();

  return new NextResponse(older?.body ?? file.body, { status: 200, headers: { ...PAGE_VIEW_HEADERS } });
}

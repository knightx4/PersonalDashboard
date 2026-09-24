import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { DOCUMENT_BUCKET, ownsDocumentPath } from '@/lib/goals/extract';

/**
 * Open a document a record was filled from (plan #955). The bucket is
 * private, so the goal page links here with the file's path and this signs a
 * one-minute link to it on your session. The bucket's policies (goals
 * migration 0011) refuse a file outside your own folder, and so does the
 * check below before storage is asked.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!ownsDocumentPath(user.id, path)) {
    return new NextResponse('No such document.', { status: 404 });
  }

  const client = await createGoalsClient();
  const { data, error } = await client.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return new NextResponse('No such document.', { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

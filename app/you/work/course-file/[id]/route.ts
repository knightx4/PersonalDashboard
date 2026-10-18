import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { COURSE_FILES_BUCKET } from '@/lib/you/transcripts';

/**
 * Open the original of a file kept under a course (plan #2401.2), as
 * ../file/[id] opens a transcript's. The bucket is private, so the course's
 * file list links here with the file's id and this signs a one-minute link on
 * your session. The row is read through RLS and the bucket's policies only
 * sign inside your own folder, so an id from somebody else's account finds
 * nothing twice over.
 */
const SIGNED_FOR_SECONDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse('No such file.', { status: 404 });

  const supabase = await createYouClient();
  const { data: row } = await supabase
    .from('course_files')
    .select('storage_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  const storagePath = (row as { storage_path: string } | null)?.storage_path;
  if (!storagePath || !storagePath.startsWith(`${user.id}/`)) {
    return new NextResponse('No such file.', { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(COURSE_FILES_BUCKET)
    .createSignedUrl(storagePath, SIGNED_FOR_SECONDS);
  if (error || !data) return new NextResponse('No such file.', { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  // The redirect names a link that expires, so no cache may keep it.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/jobs/auth/server';
import { APP_STORAGE_BUCKET } from '@/lib/jobs/db/schema-name';
import { ownsResumePath } from '@/lib/jobs/resume-file';

/**
 * Open a resume version's PDF, as /vault/education/file/<id> opens a
 * transcript. The bucket is private, so the settings page links here with the
 * version's id and this signs a one-minute link to the file on your session.
 * The row is read through RLS and the bucket's policies (job search migration
 * 0042) only sign inside your own folder, so an id from somebody else's
 * account finds nothing twice over.
 */
const SIGNED_FOR_SECONDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse('No such resume.', { status: 404 });

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('resume_versions')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  const storagePath = (row as { storage_path: string | null } | null)?.storage_path;
  if (!storagePath || !ownsResumePath(user.id, storagePath)) {
    return new NextResponse('No such resume.', { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(APP_STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_FOR_SECONDS);
  if (error || !data) return new NextResponse('No such resume.', { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  // The redirect names a link that expires, so no cache may keep it.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

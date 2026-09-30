import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { VAULT_TRANSCRIPTS_BUCKET } from '@/lib/vault/transcripts';

/**
 * Open a transcript's original file (plan #1308), as /goals/document opens a
 * goal's document. The bucket is private, so the Education tab links here
 * with the transcript's id and this signs a one-minute link to the file on
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
  if (!UUID.test(id)) return new NextResponse('No such transcript.', { status: 404 });

  const supabase = await createVaultClient();
  const { data: row } = await supabase
    .from('transcripts')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  const storagePath = (row as { storage_path: string } | null)?.storage_path;
  if (!storagePath || !storagePath.startsWith(`${user.id}/`)) {
    return new NextResponse('No such transcript.', { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(VAULT_TRANSCRIPTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_FOR_SECONDS);
  if (error || !data) return new NextResponse('No such transcript.', { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  // The redirect names a link that expires, so no cache may keep it.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

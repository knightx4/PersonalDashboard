import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { VAULT_ATTACHMENTS_BUCKET } from '@/lib/vault/paths';

/**
 * Open one of the vault's attachments (plan #1302), as /goals/document opens a
 * goal's document. The bucket is private, so a note's image, PDF or recording
 * points here and this signs a link to the copy on your session. The row is
 * read through RLS and the bucket's policy only lets you sign inside your own
 * folder, so an id from somebody else's vault finds nothing twice over.
 *
 * Signed on each request rather than when the page is drawn, so a page left
 * open still loads and nothing signed is written into it. The link lasts an
 * hour rather than /goals/document's minute because a recording is streamed:
 * the browser keeps asking the signed address for more of the file as it
 * plays and seeks, long after the redirect.
 */
const SIGNED_FOR_SECONDS = 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse('No such attachment.', { status: 404 });

  const supabase = await createVaultClient();
  const { data: row } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  const storagePath = (row as { storage_path: string | null } | null)?.storage_path;
  if (!storagePath || !storagePath.startsWith(`${user.id}/`)) {
    return new NextResponse('No such attachment.', { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(VAULT_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_FOR_SECONDS);
  if (error || !data) return new NextResponse('No such attachment.', { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  // The redirect names a link that expires, so no cache may keep it.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/jobs/auth/server';
import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { APP_STORAGE_BUCKET } from '@/lib/jobs/db/schema-name';
import { decryptToken } from '@/lib/crypto/tokens';
import { gmailProvider } from '@/lib/jobs/email/providers/gmail';

export const maxDuration = 60;

/**
 * Delete everything.
 *
 * All of it lives here rather than in a Server Action for one reason: removing
 * the auth.users row needs the service role, and the service role never belongs
 * in `app/` code that also renders. The order matters:
 *
 *   1. Revoke the Google grant. Deleting our row without revoking leaves a live
 *      grant on the user's Google account that they cannot see from here.
 *   2. Delete the storage objects, which do not cascade with database rows —
 *      and only from this app's bucket, since buckets are shared project-wide.
 *   3. Delete the auth.users row. Every table in public cascades from it, which
 *      is why one delete is enough — and tests/rls.test.ts is what would notice
 *      if a table were ever added that did not.
 *
 * The user id comes from the session. It is never read from the request.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const confirm = String(
    (await request.json().catch(() => ({}))).confirm ?? '',
  )
    .trim()
    .toLowerCase();

  if (confirm !== 'delete everything') {
    return NextResponse.json(
      { error: 'Type “delete everything” to confirm.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // 1. Revoke.
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, oauth_refresh_token')
    .eq('user_id', user.id);

  for (const account of accounts ?? []) {
    if (!account.oauth_refresh_token || !key) continue;
    try {
      await gmailProvider.revokeToken(decryptToken(account.oauth_refresh_token as string, key));
    } catch {
      // A token Google has already invalidated throws here, which is fine.
    }
  }

  // 2. Storage.
  const [{ data: attachments }, { data: resumes }] = await Promise.all([
    supabase.from('attachments').select('storage_path').eq('user_id', user.id),
    supabase.from('resume_versions').select('storage_path').eq('user_id', user.id),
  ]);

  const paths = [
    ...(attachments ?? []).map((row) => row.storage_path as string),
    ...(resumes ?? []).map((row) => row.storage_path as string),
  ].filter(Boolean);

  if (paths.length > 0) {
    // This app's own bucket. Buckets are project-wide, so naming it explicitly
    // is what stops a deletion here from touching another app's files.
    await supabase.storage.from(APP_STORAGE_BUCKET).remove(paths);
  }

  // 3. The row everything else hangs off.
  let admin: ReturnType<typeof createServiceSupabase>;
  try {
    admin = createServiceSupabase();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Service client unavailable' },
      { status: 500 },
    );
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('account delete failed', { userId: user.id, message: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}

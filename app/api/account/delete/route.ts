import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/auth/server';
import { sessionUser } from '@/lib/auth/session-user';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { APP_STORAGE_BUCKET } from '@/lib/jobs/db/schema-name';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { DOCUMENT_BUCKET } from '@/lib/goals/extract';
import { decryptToken } from '@/lib/crypto/tokens';
import { gmailProvider } from '@/lib/email/providers/gmail';

export const maxDuration = 60;

/**
 * Delete everything.
 *
 * An account action, not a workspace one: it is offered from /account, and the
 * session it authenticates is the account's rather than any one module's.
 *
 * All of it lives here rather than in a Server Action for one reason: removing
 * the auth.users row needs the service role, and the service role never belongs
 * in `app/` code that also renders. The order matters:
 *
 *   1. Revoke the Google grant. Deleting our row without revoking leaves a live
 *      grant on the user's Google account that they cannot see from here. The
 *      vault's GitHub token is the one credential that cannot be revoked from
 *      this end -- it was pasted in, it belongs to their GitHub account, and
 *      only they can delete it. The account page says so rather than implying
 *      this reaches further than it does.
 *   2. Delete the storage objects, which do not cascade with database rows --
 *      and only from this app's bucket, since buckets are shared project-wide.
 *   3. Delete the auth.users row. Every table that names a user cascades from
 *      it, in all six schemas -- public, core, job_search, obsidian, todo and
 *      learn -- which is why one delete is enough, and why
 *      tests/account-cascade.test.ts refuses a migration that adds a table
 *      naming a user without `on delete cascade`.
 *
 * Then the session goes. supabase-js treats the 401 from a user who no longer
 * exists as a successful sign-out and clears the cookies anyway, which is what
 * leaves the browser on a signed-out app rather than holding a token for an
 * account that is gone.
 *
 * The user id comes from the session. It is never read from the request.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await sessionUser(supabase);

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

  const jobs = await createJobsClient();
  const core = await createCoreClient();

  // 1. Revoke.
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  const { data: accounts } = await core
    .from('email_accounts')
    .select('id, oauth_refresh_token')
    .eq('user_id', user.id);

  for (const account of accounts ?? []) {
    if (!account.oauth_refresh_token || !key) continue;
    try {
      await gmailProvider.revokeToken(decryptToken(account.oauth_refresh_token as string, key));
    } catch {
      // A token Google has already invalidated throws here, which is fine. A
      // grant we cannot revoke must not be a reason to refuse to delete: the
      // person asked to leave, and the row is the part we control.
    }
  }

  // 2. Storage. Both tables live in the job search schema, which is also the
  //    only workspace that stores files at all -- everything else is rows.
  const [{ data: attachments }, { data: resumes }] = await Promise.all([
    jobs.from('attachments').select('storage_path').eq('user_id', user.id),
    jobs.from('resume_versions').select('storage_path').eq('user_id', user.id),
  ]);

  const paths = [
    ...(attachments ?? []).map((row) => row.storage_path as string),
    ...(resumes ?? []).map((row) => row.storage_path as string),
  ].filter(Boolean);

  if (paths.length > 0) {
    // This app's own bucket. Buckets are project-wide, so naming it explicitly
    // is what stops a deletion here from touching another app's files.
    await jobs.storage.from(APP_STORAGE_BUCKET).remove(paths);
  }

  //    Goals keeps the documents forms were filled from (plan #955) in its
  //    own bucket, one folder per account, so the folder is the list.
  try {
    const goals = await createGoalsClient();
    const { data: documents } = await goals.storage
      .from(DOCUMENT_BUCKET)
      .list(user.id, { limit: 1000 });
    const documentPaths = (documents ?? []).map((file) => `${user.id}/${file.name}`);
    if (documentPaths.length > 0) await goals.storage.from(DOCUMENT_BUCKET).remove(documentPaths);
  } catch {
    // A file left behind is not a reason to refuse the deletion.
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

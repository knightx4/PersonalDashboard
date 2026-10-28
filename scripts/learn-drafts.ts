/**
 * The routine's side of drafting Learn topics (learn 0193;
 * .claude/skills/learn-drafts/SKILL.md). The app queues a topic instead of
 * calling the API; the routine's session takes it here, writes the draft
 * itself, and saves it here, which checks and keeps it as the API path did.
 *
 *   npm run learn:drafts -- status               # how many wait, are drafting, done and failed
 *   npm run learn:drafts -- next                 # take the next request: its id, goal, system, prompt and tool schema
 *   npm run learn:drafts -- save <id> <file>     # keep the draft in <file> (the tool's input, as JSON)
 *   npm run learn:drafts -- fail <id> "<why>"    # give a request up, saying why
 *
 * Every read and write is for the app's owner. Needs SUPABASE_SERVICE_ROLE_KEY
 * and the project (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF). When the
 * last of a preparation's requests is saved and CRON_SECRET and
 * NEXT_PUBLIC_APP_URL are set, the preparation is resumed on the live app;
 * otherwise the daily cron resumes it.
 */
import { readFileSync } from 'node:fs';
import { supabaseProjectRef } from '../lib/db/project';

// The service-role client is all this uses; the app's env check also wants
// the public pair, which a routine's environment may not carry.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = supabaseProjectRef();
  if (ref) process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused-by-the-service-role';

async function main() {
  const { createLearnServiceSupabase } = await import('@/inngest/learn/supabase-admin');
  const { createServiceSupabase } = await import('@/inngest/supabase-admin');
  const { draftRequestPrompt, failDraftRequest, keepRoutineDraft, takeDraftRequest } = await import(
    '@/lib/learn/levels/draft-run'
  );
  const { DRAFT_REQUEST_COLUMNS, readDraftRequest } = await import('@/lib/learn/levels/draft-request');
  const { kickPreparation } = await import('@/lib/learn/prepare/kick');

  const [command, ...rest] = process.argv.slice(2);
  const { data: owner } = await createServiceSupabase().rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const learn = createLearnServiceSupabase();
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

  if (command === 'status') {
    const { data, error } = await learn.from('topic_draft_requests').select('status').eq('user_id', userId);
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = { queued: 0, drafting: 0, done: 0, failed: 0 };
    for (const row of (data ?? []) as { status: string }[]) counts[row.status] = (counts[row.status] ?? 0) + 1;
    print(counts);
    return;
  }

  if (command === 'next') {
    const request = await takeDraftRequest(learn, userId);
    if (!request) {
      print({ request: null });
      return;
    }
    const { system, prompt, tool } = await draftRequestPrompt(learn, request);
    print({ request: { id: request.id, goal: request.goal }, system, prompt, tool });
    return;
  }

  const [id, arg] = rest;
  if (!id) throw new Error(`Usage: learn-drafts ${command ?? '<status|next|save|fail>'} <id> …`);
  const { data: row, error } = await learn
    .from('topic_draft_requests')
    .select(DRAFT_REQUEST_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error(`No request ${id} for the owner.`);
  const request = readDraftRequest(row as Record<string, unknown>);

  if (command === 'fail') {
    await failDraftRequest(learn, userId, id, arg?.trim() || 'The routine could not draft it.');
    print({ failed: id });
    await resumeIfLast(request.preparationId);
    return;
  }

  if (command === 'save') {
    if (!arg) throw new Error('Usage: learn-drafts save <id> <file>');
    if (request.status === 'done') throw new Error(`Request ${id} is already saved.`);
    let report: unknown;
    try {
      report = JSON.parse(readFileSync(arg, 'utf8'));
    } catch (caught) {
      throw new Error(`Could not read ${arg} as JSON: ${caught instanceof Error ? caught.message : caught}`);
    }
    const kept = await keepRoutineDraft(learn, request, report);
    print(kept);
    if (!kept.ok) process.exitCode = 1;
    else await resumeIfLast(request.preparationId);
    return;
  }

  throw new Error(`Unknown command ${command ?? '(none)'}: status, next, save or fail.`);

  async function resumeIfLast(preparationId: string | null) {
    if (!preparationId) return;
    const { count } = await learn
      .from('topic_draft_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId as string)
      .eq('preparation_id', preparationId)
      .in('status', ['queued', 'drafting']);
    if (count) return;
    const { data: run } = await learn
      .from('subject_preparations')
      .select('subject_id, branch_key')
      .eq('id', preparationId)
      .eq('user_id', userId as string)
      .maybeSingle();
    const origin = process.env.NEXT_PUBLIC_APP_URL;
    const resumed =
      run && origin && process.env.CRON_SECRET
        ? await kickPreparation(origin, run.subject_id as string, (run.branch_key as string | null) ?? null)
        : false;
    print({ preparation: preparationId, resumed, note: resumed ? 'Resumed on the app.' : 'The daily cron resumes it.' });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

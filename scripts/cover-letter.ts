/**
 * The session's side of drafting a cover letter (job_search 0084;
 * .claude/skills/cover-letters/SKILL.md, the one cover letter skill). The
 * Draft button queues a request and fires the routine; a session asked
 * directly queues one with `start`. Either way the session reads the material
 * here, writes the letter itself with the skill, and saves it here, which
 * checks it and keeps it beside the editor.
 *
 *   npm run cover-letter -- start <application or role id>  # queue a letter without the button (a session asked directly); prints the request id
 *   npm run cover-letter -- show <request id>          # mark it drafting; print the material, the request and the report's shape
 *   npm run cover-letter -- save <request id> <file> [--any-length]   # keep the report in <file> (JSON: letter, evidence_item_ids, unsupported_claims, asks); --any-length only when the person asked for another length
 *   npm run cover-letter -- fail <request id> "<why>"  # give it up, saying why; the tab shows the reason
 *
 * Every read and write is for the app's owner. Needs SUPABASE_SERVICE_ROLE_KEY
 * and the project (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF).
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
  const { createServiceSupabase, createServiceSchemaSupabase } = await import('@/inngest/supabase-admin');
  const { createServiceSupabase: createJobsServiceSupabase } = await import('@/inngest/jobs/supabase-admin');
  const { loadThreads } = await import('@/lib/thread/store');
  const { VAULT_SOURCES } = await import('@/lib/jobs/drafting/gather');
  const { LETTER_TOOL, keepLetter, letterPrompt } = await import('@/lib/jobs/drafting/draft-cover-letter');
  const { aiWeight } = await import('@/lib/jobs/drafting/draft-cover-letter-payload');
  const { LETTER_REQUEST_COLUMNS, readLetterRequest, settleLetterRequest } = await import(
    '@/lib/jobs/drafting/letter-request'
  );

  const argv = process.argv.slice(2);
  const anyLength = argv.includes('--any-length');
  const [command, id, arg] = argv.filter((a) => a !== '--any-length');
  if (!command || !id) throw new Error('Usage: cover-letter <start|show|save|fail> <id> …');

  const { data: owner } = await createServiceSupabase().rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const jobs = createJobsServiceSupabase();
  const core = createServiceSchemaSupabase('core');
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

  if (command === 'start') {
    // An application id, or a role id whose newest application is taken.
    const { data: byId } = await jobs.from('applications').select('id').eq('id', id).eq('user_id', userId).maybeSingle();
    const { data: byRole } = byId
      ? { data: null }
      : await jobs
          .from('applications')
          .select('id')
          .eq('role_id', id)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
    const applicationId = (byId?.id ?? byRole?.id) as string | undefined;
    if (!applicationId) throw new Error(`No application or role ${id} for the owner.`);
    const { data: open } = await jobs
      .from('cover_letter_requests')
      .select('id')
      .eq('user_id', userId)
      .eq('application_id', applicationId)
      .in('status', ['queued', 'drafting'])
      .maybeSingle();
    if (open) {
      print({ request: open.id, applicationId, note: 'A letter was already queued for this application; use this request.' });
      return;
    }
    const { data: made, error: madeError } = await jobs
      .from('cover_letter_requests')
      .insert({ user_id: userId, application_id: applicationId, status: 'queued' })
      .select('id')
      .single();
    if (madeError || !made) throw new Error(madeError?.message ?? 'Could not queue the letter.');
    print({ request: made.id, applicationId });
    return;
  }

  const { data: row, error } = await jobs
    .from('cover_letter_requests')
    .select(LETTER_REQUEST_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error(`No cover letter request ${id} for the owner.`);
  const request = readLetterRequest(row as Record<string, unknown>);

  if (command === 'fail') {
    const settled = await settleLetterRequest(jobs, userId, id, {
      status: 'failed',
      error: arg?.trim() || 'Dash could not write the letter.',
    });
    if (settled.error) throw new Error(settled.error);
    print({ failed: id });
    return;
  }

  if (request.status === 'done') throw new Error(`Request ${id} is already saved.`);
  const deps = {
    jobs,
    core,
    vaultSources: VAULT_SOURCES,
    threads: (refs: readonly string[]) => loadThreads(createServiceSupabase(), refs, { userId }),
  };
  const prepared = await letterPrompt(deps, { userId, applicationId: request.applicationId });
  if (!prepared.ok) throw new Error(prepared.error);
  const { prompt } = prepared;

  if (command === 'show') {
    const settled = await settleLetterRequest(jobs, userId, id, { status: 'drafting' });
    if (settled.error) throw new Error(settled.error);
    print({
      request: { id, applicationId: request.applicationId },
      role: { id: prompt.material.role.roleId, title: prompt.material.role.title, company: prompt.material.role.company },
      ai_weight: aiWeight(prompt.material.role),
      material: prompt.materialText,
      request_text: prompt.requestText,
      evidence_ids: prompt.material.evidence.items.map((item) => item.id),
      banned: prompt.material.style.banned,
      report: LETTER_TOOL,
    });
    return;
  }

  if (command === 'save') {
    if (!arg) throw new Error('Usage: cover-letter save <request id> <file>');
    let report: unknown;
    try {
      report = JSON.parse(readFileSync(arg, 'utf8'));
    } catch (caught) {
      throw new Error(`Could not read ${arg} as JSON: ${caught instanceof Error ? caught.message : caught}`);
    }
    const kept = await keepLetter(
      { jobs },
      { userId, applicationId: request.applicationId, prompt, ...(anyLength ? { words: null } : {}) },
      report,
    );
    if (!kept.ok) {
      print(kept);
      process.exitCode = 1;
      return;
    }
    const settled = await settleLetterRequest(jobs, userId, id, { status: 'done' });
    if (settled.error) throw new Error(settled.error);
    print({ ok: true, words: kept.draft.words, banned_found: kept.draft.bannedFound, asks: kept.draft.asks });
    return;
  }

  throw new Error(`Unknown command ${command}: start, show, save or fail.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

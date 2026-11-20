/**
 * The routine's side of drafting a cover letter (job_search 0084;
 * .claude/skills/cover-letters/SKILL.md). The Draft button queues a request
 * instead of calling the API; the routine's session reads the material here,
 * writes the letter itself with the person's cover letter skill, and saves it
 * here, which checks it as the API reply was checked and keeps it beside the
 * editor.
 *
 *   npm run cover-letter -- show <request id>          # mark it drafting; print the material, the request and the report's shape
 *   npm run cover-letter -- save <request id> <file>   # keep the report in <file> (JSON: letter, evidence_item_ids, unsupported_claims, asks)
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
  const { LETTER_REQUEST_COLUMNS, readLetterRequest, settleLetterRequest } = await import(
    '@/lib/jobs/drafting/letter-request'
  );

  const [command, id, arg] = process.argv.slice(2);
  if (!command || !id) throw new Error('Usage: cover-letter <show|save|fail> <request id> …');

  const { data: owner } = await createServiceSupabase().rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const jobs = createJobsServiceSupabase();
  const core = createServiceSchemaSupabase('core');
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

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
    const kept = await keepLetter({ jobs }, { userId, applicationId: request.applicationId, prompt }, report);
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

  throw new Error(`Unknown command ${command}: show, save or fail.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

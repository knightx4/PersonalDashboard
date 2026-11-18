/**
 * The routine's side of the reader (learn 0195;
 * .claude/skills/learn-reader/SKILL.md; docs/LEARN-READER-SPEC.md). The app
 * queues a source instead of calling the API; the routine's session takes it
 * here, prepares it, and saves it here, which checks it before it is kept.
 *
 *   npm run learn:reader -- status                       # what is queued, being prepared, ready and failed
 *   npm run learn:reader -- next [id]                    # take the next queued source (or this one)
 *   npm run learn:reader -- add <file>                   # queue a source: {title, author, origin, why, asked, readingId}
 *   npm run learn:reader -- check <file> [fulltext]      # check a prepared source without the database
 *   npm run learn:reader -- save <id> <file> <basis> [fulltext]
 *                                                        # keep a prepared source; basis is text, read or memory
 *   npm run learn:reader -- done <id>                    # close a request for more to read
 *   npm run learn:reader -- fail <id> "<why>"            # give a source up, saying why
 *
 * Every read and write is for the app's owner. Needs SUPABASE_SERVICE_ROLE_KEY
 * and the project (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF).
 */
import { readFileSync } from 'node:fs';
import { supabaseProjectRef } from '../lib/db/project';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = supabaseProjectRef();
  if (ref) process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused-by-the-service-role';

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (caught) {
    throw new Error(
      `Could not read ${file} as JSON: ${caught instanceof Error ? caught.message : caught}`,
    );
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { BASES, checkSource } = await import('@/lib/learn/reader/source');

  if (command === 'check') {
    const [file, fullTextFile] = rest;
    if (!file) throw new Error('Usage: learn-reader check <file> [fulltext]');
    const checked = checkSource(
      readJson(file),
      fullTextFile ? readFileSync(fullTextFile, 'utf8') : null,
    );
    if (!checked.ok) {
      print(checked);
      process.exitCode = 1;
      return;
    }
    print({
      ok: true,
      title: checked.source.title,
      rights: checked.source.rights,
      sections: checked.source.sections.length,
      minutes: checked.source.minutes,
    });
    return;
  }

  const { createLearnServiceSupabase } = await import('@/inngest/learn/supabase-admin');
  const { createServiceSupabase } = await import('@/inngest/supabase-admin');
  const store = await import('@/lib/learn/reader/store');

  const { data: owner } = await createServiceSupabase().rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const learn = createLearnServiceSupabase();

  if (command === 'status') {
    const { data, error } = await learn
      .from('reader_sources')
      .select('id, title, origin, status, basis, verdict, progress')
      .eq('user_id', userId)
      .order('requested_at');
    if (error) throw new Error(error.message);
    print(data);
    return;
  }

  if (command === 'next') {
    const row = await store.takeSource(learn, userId, rest[0]);
    if (!row) return print({ source: null });
    const given = typeof row.given_text === 'string' ? row.given_text : null;
    print({
      source: {
        id: row.id,
        title: row.title,
        author: row.author,
        origin: row.origin,
        asked: row.asked,
        why: row.why,
        readingId: row.reading_id,
        parentId: row.parent_id,
        parentSection: row.parent_section,
        // The person's own copy, when they pasted one: the text to prepare from.
        givenTextCharacters: given ? given.length : 0,
        hasEarlierPreparation: Boolean(row.prepared),
      },
    });
    return;
  }

  if (command === 'add') {
    if (!rest[0]) throw new Error('Usage: learn-reader add <file>');
    const input = readJson(rest[0]) as Record<string, unknown>;
    const origin = input.origin;
    if (typeof input.title !== 'string' || !input.title.trim())
      throw new Error('The source needs a title.');
    if (origin !== 'note' && origin !== 'new' && origin !== 'asked' && origin !== 'deeper')
      throw new Error('The origin is note, new, asked or deeper.');
    const queued = await store.queueSource(learn, userId, {
      title: input.title,
      author: typeof input.author === 'string' ? input.author : null,
      origin,
      asked: typeof input.asked === 'string' ? input.asked : null,
      why: typeof input.why === 'string' ? input.why : null,
      readingId: typeof input.readingId === 'string' ? input.readingId : null,
      parentId: typeof input.parentId === 'string' ? input.parentId : null,
      parentSection: typeof input.parentSection === 'number' ? input.parentSection : null,
    });
    print(queued);
    return;
  }

  const [id, ...args] = rest;
  if (!id) throw new Error(`Usage: learn-reader ${command ?? '<command>'} <id> …`);

  if (command === 'text') {
    // The person's own copy of a source, written to a file for the session to prepare from.
    const { data, error } = await learn
      .from('reader_sources')
      .select('given_text')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) throw new Error(`No source ${id} for the owner.`);
    process.stdout.write(((data as { given_text: string | null }).given_text ?? '') + '\n');
    return;
  }

  if (command === 'save') {
    const [file, basis, fullTextFile] = args;
    if (!file || !basis)
      throw new Error('Usage: learn-reader save <id> <file> <text|read|memory> [fulltext]');
    if (!(BASES as readonly string[]).includes(basis))
      throw new Error('The basis is text, read or memory.');
    const saved = await store.saveSource(learn, userId, id, readJson(file), {
      basis: basis as (typeof BASES)[number],
      fullText: fullTextFile ? readFileSync(fullTextFile, 'utf8') : null,
    });
    print(saved);
    if (!saved.ok) process.exitCode = 1;
    return;
  }

  if (command === 'done') {
    await store.finishRefill(learn, userId, id);
    print({ done: id });
    return;
  }

  if (command === 'fail') {
    await store.failSource(
      learn,
      userId,
      id,
      args.join(' ').trim() || 'The routine could not prepare it.',
    );
    print({ failed: id });
    return;
  }

  throw new Error(`Unknown command ${command ?? '(none)'}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

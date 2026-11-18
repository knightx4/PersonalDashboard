/**
 * The routine's side of building a course digest (learn 0194;
 * .claude/skills/learn-courses/SKILL.md; docs/LEARN-DIGEST-SPEC.md). The app
 * queues a course instead of calling the API; the routine's session takes it
 * here, reports each stage here so the course's page can show it, and saves
 * the digest here, which checks it before it is kept.
 *
 *   npm run learn:course -- status                          # the queue and what is built
 *   npm run learn:course -- next [id]                       # take the next queued course (or this one)
 *   npm run learn:course -- add <file>                      # queue a course from {title, provider, sourceUrl, about, goal, budgetMinutes}
 *   npm run learn:course -- step <id> <key> <state> [detail] # report a stage: waiting, running, done or failed
 *   npm run learn:course -- inventory <id> <file>           # keep the videos: [{code, title, videoId, durationSeconds, speaker}]
 *   npm run learn:course -- transcripts <id> <dir>          # fetch every transcript, write <dir>/<code>.txt, count them
 *   npm run learn:course -- notes <id> <code> <file>        # keep one lecture's notes
 *   npm run learn:course -- counts <id>                     # lectures against notes
 *   npm run learn:course -- export <id> <dir>               # write lectures.json and every notes file back out
 *   npm run learn:course -- check <lectures.json> <digest>  # check a digest file without the database
 *   npm run learn:course -- save <id> <file>                # check the digest against the stored lectures and keep it
 *   npm run learn:course -- fail <id> "<why>"               # give a course up, saying why
 *
 * Every read and write is for the app's owner. Needs SUPABASE_SERVICE_ROLE_KEY
 * and the project (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF);
 * `transcripts` also needs TRANSCRIPTAPI_KEY.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const { checkDigest, checkLectures, clock, digestTotals } =
    await import('@/lib/learn/courses/digest');

  // Checking a file needs no database, so a session can fix a digest before it saves one.
  if (command === 'check') {
    const [lecturesFile, digestFile] = rest;
    if (!lecturesFile || !digestFile)
      throw new Error('Usage: learn-course check <lectures.json> <digest.json>');
    const lectures = checkLectures(readJson(lecturesFile));
    if (!lectures.ok) {
      print(lectures);
      process.exitCode = 1;
      return;
    }
    const checked = checkDigest(readJson(digestFile), lectures.lectures);
    if (!checked.ok) {
      print(checked);
      process.exitCode = 1;
      return;
    }
    print({
      ok: true,
      totals: digestTotals(checked.digest, lectures.lectures),
      stages: checked.digest.plan.stages.map((stage) => `${stage.key} (${stage.steps.length} steps, after ${stage.after.join(" and ") || "nothing"})`),
    });
    return;
  }

  const { createLearnServiceSupabase } = await import('@/inngest/learn/supabase-admin');
  const { createServiceSupabase } = await import('@/inngest/supabase-admin');
  const store = await import('@/lib/learn/courses/store');
  const { isStepKey, BUILD_STEPS } = await import('@/lib/learn/courses/build');

  const { data: owner } = await createServiceSupabase().rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const learn = createLearnServiceSupabase();

  if (command === 'status') {
    const courses = await store.loadCourses(learn, userId);
    print(
      courses.map((course) => ({
        id: course.id,
        title: course.title,
        status: course.status,
        videos: course.totals.videos ?? null,
        error: course.error,
      })),
    );
    return;
  }

  if (command === 'next') {
    const course = await store.takeCourse(learn, userId, rest[0]);
    if (!course) return print({ course: null });
    const counts = await store.noteCounts(learn, userId, course.id);
    print({
      course: {
        id: course.id,
        title: course.title,
        provider: course.provider,
        sourceUrl: course.sourceUrl,
        about: course.about,
        goal: course.goal,
        budgetMinutes: course.budgetMinutes,
      },
      // A build that was interrupted picks up from what is stored.
      stored: counts,
    });
    return;
  }

  if (command === 'add') {
    if (!rest[0]) throw new Error('Usage: learn-course add <file>');
    const input = readJson(rest[0]) as Record<string, unknown>;
    if (typeof input.title !== 'string' || !input.title.trim())
      throw new Error('The course needs a title.');
    const queued = await store.queueCourse(learn, userId, {
      title: input.title,
      provider: typeof input.provider === 'string' ? input.provider : null,
      sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl : null,
      about: typeof input.about === 'string' ? input.about : null,
      goal: typeof input.goal === 'string' ? input.goal : null,
      budgetMinutes: typeof input.budgetMinutes === 'number' ? input.budgetMinutes : undefined,
      catalogueKey: typeof input.catalogueKey === 'string' ? input.catalogueKey : null,
    });
    print(queued);
    return;
  }

  const [id, ...args] = rest;
  if (!id) throw new Error(`Usage: learn-course ${command ?? '<command>'} <id> …`);

  if (command === 'step') {
    const [key, state, ...detail] = args;
    if (!key || !isStepKey(key))
      throw new Error(`The stage is one of: ${BUILD_STEPS.map((step) => step.key).join(', ')}.`);
    if (state !== 'waiting' && state !== 'running' && state !== 'done' && state !== 'failed')
      throw new Error('The state is waiting, running, done or failed.');
    const steps = await store.reportStep(
      learn,
      userId,
      id,
      key,
      state,
      detail.join(' ').trim() || null,
    );
    print(
      steps.map(
        (step) => `${step.state.padEnd(7)} ${step.label}${step.detail ? `: ${step.detail}` : ''}`,
      ),
    );
    return;
  }

  if (command === 'inventory') {
    if (!args[0]) throw new Error('Usage: learn-course inventory <id> <file>');
    const saved = await store.saveLectures(learn, userId, id, readJson(args[0]));
    if (!saved.ok) {
      print(saved);
      process.exitCode = 1;
      return;
    }
    const seconds = saved.lectures.reduce((sum, lecture) => sum + lecture.durationSeconds, 0);
    await store.reportStep(
      learn,
      userId,
      id,
      'inventory',
      'done',
      `${saved.lectures.length} videos, ${clock(seconds)}`,
    );
    print({ ok: true, videos: saved.lectures.length, runtime: clock(seconds) });
    return;
  }

  if (command === 'transcripts') {
    const dir = args[0];
    if (!dir) throw new Error('Usage: learn-course transcripts <id> <dir>');
    const { transcribeVideos, loadTranscript, loadCreditState } =
      await import('@/lib/learn/youtube/transcripts');
    const { paragraphsFromCues } = await import('@/lib/learn/youtube/paragraphs');
    const lectures = await store.loadLectures(learn, userId, id);
    if (lectures.length === 0)
      throw new Error('The course has no lectures stored; save the inventory first.');
    mkdirSync(dir, { recursive: true });
    await store.reportStep(learn, userId, id, 'transcripts', 'running', `0 of ${lectures.length}`);
    const credits = await loadCreditState(learn);
    const fetched = await transcribeVideos(
      learn,
      lectures.map((lecture) => lecture.videoId),
      { trigger: 'press', maxCredits: credits.remaining },
    );
    const written: string[] = [];
    const missing: string[] = [];
    for (const lecture of lectures) {
      const stored = await loadTranscript(learn, lecture.videoId);
      if (!stored || stored.cues.length === 0) {
        missing.push(lecture.code);
        continue;
      }
      // Paragraphs of about 45 seconds, each starting [m:ss|seconds], so a
      // timestamp in the notes can be quoted exactly (spec lesson 4).
      const body = paragraphsFromCues(stored.cues, 45)
        .map(
          (paragraph) =>
            `[${clock(paragraph.startSeconds)}|${Math.round(paragraph.startSeconds)}] ${paragraph.text}`,
        )
        .join('\n\n');
      const head = `# ${lecture.code} ${lecture.title}\nvideo ${lecture.videoId} | ${clock(lecture.durationSeconds)} | ${lecture.speaker ?? 'speaker not listed'}${stored.language?.startsWith('asr') ? ' | auto-captioned: check numbers against context' : ''}\n\n`;
      writeFileSync(join(dir, `${lecture.code}.txt`), head + body);
      written.push(lecture.code);
    }
    const complete = missing.length === 0;
    await store.reportStep(
      learn,
      userId,
      id,
      'transcripts',
      complete ? 'done' : 'failed',
      `${written.length} of ${lectures.length}${complete ? '' : `; none for ${missing.join(', ')}`}`,
    );
    print({
      ok: complete,
      written: written.length,
      of: lectures.length,
      missing,
      creditsSpent: fetched.credits,
      stopped: fetched.stopped,
    });
    if (!complete) process.exitCode = 1;
    return;
  }

  if (command === 'notes') {
    const [code, file] = args;
    if (!code || !file) throw new Error('Usage: learn-course notes <id> <code> <file>');
    await store.saveNotes(learn, userId, id, code, readFileSync(file, 'utf8'));
    const counts = await store.noteCounts(learn, userId, id);
    await store.reportStep(
      learn,
      userId,
      id,
      'notes',
      counts.missing.length === 0 ? 'done' : 'running',
      `${counts.noted} of ${counts.total}`,
    );
    print({ ok: true, noted: counts.noted, of: counts.total });
    return;
  }

  if (command === 'counts') {
    print(await store.noteCounts(learn, userId, id));
    return;
  }

  if (command === 'export') {
    const dir = args[0];
    if (!dir) throw new Error('Usage: learn-course export <id> <dir>');
    mkdirSync(dir, { recursive: true });
    const lectures = await store.loadLectures(learn, userId, id);
    writeFileSync(join(dir, 'lectures.json'), JSON.stringify(lectures, null, 2));
    const { data, error } = await learn
      .from('course_lectures')
      .select('code, notes')
      .eq('course_id', id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    let notes = 0;
    for (const row of (data ?? []) as { code: string; notes: string | null }[]) {
      if (!row.notes) continue;
      writeFileSync(join(dir, `${row.code}.notes.md`), row.notes);
      notes += 1;
    }
    print({ ok: true, lectures: lectures.length, notes });
    return;
  }

  if (command === 'save') {
    if (!args[0]) throw new Error('Usage: learn-course save <id> <file>');
    const saved = await store.saveDigest(learn, userId, id, readJson(args[0]));
    print(saved);
    if (!saved.ok) process.exitCode = 1;
    return;
  }

  if (command === 'fail') {
    await store.failCourse(
      learn,
      userId,
      id,
      args.join(' ').trim() || 'The routine could not build it.',
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

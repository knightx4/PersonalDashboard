/**
 * A course digest: a long lecture series cut down to what one person needs
 * (docs/LEARN-DIGEST-SPEC.md). This file is the contract between the session
 * that writes a digest (.claude/skills/learn-courses/SKILL.md) and the pages
 * that draw it: the shape, and the checks a digest must pass before it is
 * kept.
 *
 * The centre of a digest is its plan: stages in the order the ideas rest on
 * each other, each a run of steps taken one after another. A stage names the
 * stages it comes after, so a course can open on shared ground and then
 * branch. A step is made of blocks in reading order: commentary, a clip, a
 * drawing, a piece of a reading, a question to try.
 *
 * Text fields are markdown. A moment in a lecture is written as a token,
 * `[[L07 21:49]]` or `[[L07 21:49-29:39]]`, never as a URL: the link is built
 * from the lecture's stored video id (rule D2), and a token naming a lecture
 * the course lacks, or a time past its end, fails the check.
 */
import { svgProblems } from '@/lib/learn/reader/source';

/** A step shorter than this is a note, and belongs inside the step beside it. */
export const MIN_STEP_MINUTES = 4;

export const RATINGS = ['watch', 'parts', 'skim', 'skip'] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABEL: Record<Rating, string> = {
  watch: 'Watch whole',
  parts: 'Watch parts',
  skim: 'Skim',
  skip: 'Skip',
};

export type Lecture = {
  /** Short and unique in the course: L07, P09, K03. */
  code: string;
  title: string;
  videoId: string;
  durationSeconds: number;
  speaker: string | null;
};

export type Block =
  /** Commentary or a text lesson: what to know before or after what sits beside it. */
  | { type: 'text'; title: string | null; body: string }
  /** A stretch of a lecture, played in the page. */
  | {
      type: 'clip';
      code: string;
      /** Seconds from the start of the lecture. */
      start: number;
      end: number;
      minutes: number;
      /** What to listen for, in one sentence. */
      listenFor: string;
    }
  /** A drawing, in the page's own colours (svgProblems). */
  | { type: 'figure'; caption: string; svg: string }
  /**
   * A reading that belongs at this point. `body` says what it is and why it is
   * here. `excerpt` holds the author's own paragraphs, and only where
   * `licence` names the open licence the text was published under.
   */
  | {
      type: 'reading';
      title: string;
      author: string | null;
      source: string | null;
      url: string | null;
      body: string;
      excerpt: string[];
      licence: string | null;
    }
  /** A case to work or a thing to explain, with a full answer. */
  | { type: 'check'; question: string; answer: string };

export type Step = {
  /** The stage's key and the step's place in it: `B.2`. */
  key: string;
  title: string;
  /**
   * What the learner can do or explain after it, in one sentence. Null on a
   * plan kept before steps carried one.
   */
  gain: string | null;
  /** Watching and reading time, worked out from the blocks. */
  minutes: number;
  blocks: Block[];
};

export type Stage = {
  key: string;
  title: string;
  /** A few words for the stage's place on the map: "Measuring risk". */
  short: string;
  /** What this stage gets you, in a sentence or two. */
  about: string;
  /** The stages to finish first. Empty for where the course starts. */
  after: string[];
  steps: Step[];
};

export type Plan = {
  intro: string;
  /** The watching time the plan was cut to fit. */
  budgetMinutes: number;
  stages: Stage[];
};

export type Digest = {
  /** Who this was cut for and to what end, in a sentence or two. */
  madeFor: string;
  /** How to use it: what was read, what the codes mean. */
  intro: string;
  plan: Plan;
  ratings: { intro: string; rows: { code: string; rating: Rating; watch: string; why: string }[] };
  ideas: { title: string; body: string }[];
  errors: { intro: string; rows: { where: string; said: string; correction: string }[] };
};

/** A digest kept before plans (learn 0194's first shape) has none; the pages say so. */
export function hasPlan(digest: Digest | null): digest is Digest {
  return Array.isArray((digest as { plan?: { stages?: unknown } } | null)?.plan?.stages);
}

/** `1:21:15` or `21:49` as seconds; null when it is not a time. */
export function secondsOf(text: string): number | null {
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(text.trim())) return null;
  return text
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}

/** Seconds as `21:49` or `1:21:15`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** The address of a moment in a lecture. Built from the stored id, never typed (D2). */
export function watchUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.round(seconds))}`;
}

const TOKEN =
  /\[\[([A-Za-z]{1,3}\d{1,3}) (\d{1,2}(?::\d{2}){1,2})(?:-(\d{1,2}(?::\d{2}){1,2}))?\]\]/g;

export type Moment = { code: string; start: number; end: number | null; raw: string };

/** Every moment token in a piece of text, in order. */
export function momentsIn(text: string): Moment[] {
  const found: Moment[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const start = secondsOf(match[2]);
    if (start === null) continue;
    found.push({
      code: match[1],
      start,
      end: match[3] ? secondsOf(match[3]) : null,
      raw: match[0],
    });
  }
  return found;
}

/**
 * The text with each token turned into a markdown link to that moment. A
 * token whose lecture is unknown is left as its plain text, so a digest that
 * somehow got past the check still reads.
 */
export function linkMoments(
  text: string,
  lectures: readonly Lecture[],
  /** Where a moment opens. The pages pass their own player; the default is YouTube. */
  href: (lecture: Lecture, start: number) => string = (lecture, start) =>
    watchUrl(lecture.videoId, start),
): string {
  const byCode = new Map(lectures.map((lecture) => [lecture.code, lecture]));
  return text.replace(TOKEN, (raw, code: string, from: string, to: string | undefined) => {
    const lecture = byCode.get(code);
    const start = secondsOf(from);
    if (!lecture || start === null) return `${code} ${from}`;
    const label = to ? `${code} ${from} to ${to}` : `${code} ${from}`;
    return `[${label}](${href(lecture, start)})`;
  });
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A time given as seconds or as a clock string. */
function time(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === 'string') return secondsOf(value);
  return null;
}

export type DigestCheck = { ok: true; digest: Digest } | { ok: false; problems: string[] };

/**
 * Read what a session wrote as a digest and check it against the lectures.
 * Every problem is listed, so one pass of fixes can clear them all.
 */
export function checkDigest(input: unknown, lectures: readonly Lecture[]): DigestCheck {
  const problems: string[] = [];
  const byCode = new Map(lectures.map((lecture) => [lecture.code, lecture]));
  if (!isObject(input)) return { ok: false, problems: ['The digest is not an object.'] };

  /** Everything written for the reader, kept to check it for the plan's own codes. */
  const written: [string, string][] = [];
  const prose = (value: unknown, where: string, required = true): string => {
    const body = text(value);
    if (body) written.push([where, body]);
    if (!body && required) problems.push(`${where} is empty.`);
    if (body.includes('—')) problems.push(`${where} has an em dash.`);
    if (/https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(body)) {
      problems.push(`${where} has a typed YouTube link; write a [[code m:ss]] token.`);
    }
    for (const moment of momentsIn(body))
      inside(moment.code, moment.start, moment.end, `${where} ${moment.raw}`);
    for (const stray of body.match(/\[\[[^\]]*\]\]/g) ?? []) {
      if (momentsIn(stray).length === 0)
        problems.push(`${where} has a token that does not read: ${stray}`);
    }
    return body;
  };

  function inside(code: string, start: number | null, end: number | null, where: string): boolean {
    const lecture = byCode.get(code);
    if (!lecture) {
      problems.push(`${where} names lecture ${code}, which the course does not have.`);
      return false;
    }
    if (start === null) {
      problems.push(`${where} has no start time.`);
      return false;
    }
    if (start >= lecture.durationSeconds) {
      problems.push(
        `${where} starts at ${clock(start)}, past the end of ${code} (${clock(lecture.durationSeconds)}).`,
      );
      return false;
    }
    if (end !== null && end <= start) {
      problems.push(`${where} ends at or before it starts.`);
      return false;
    }
    if (end !== null && end > lecture.durationSeconds + 1) {
      problems.push(
        `${where} ends at ${clock(end)}, past the end of ${code} (${clock(lecture.durationSeconds)}).`,
      );
      return false;
    }
    return true;
  }

  const words = (body: string) => body.split(/\s+/).filter(Boolean).length;
  const planIn = isObject(input.plan) ? input.plan : {};
  const budgetMinutes =
    typeof planIn.budgetMinutes === 'number' && planIn.budgetMinutes > 0
      ? Math.round(planIn.budgetMinutes)
      : 180;
  const stages: Stage[] = [];
  const stageKeys = new Set<string>();
  let watchSeconds = 0;
  list(planIn.stages).forEach((raw, index) => {
    const where = `Stage ${index + 1}`;
    if (!isObject(raw)) return void problems.push(`${where} is not an object.`);
    const key = text(raw.key) || String.fromCharCode(65 + index);
    if (!/^[A-Za-z0-9]{1,4}$/.test(key)) problems.push(`${where} needs a short key like A or B2.`);
    if (stageKeys.has(key)) problems.push(`${where} repeats the key ${key}.`);
    // A stage comes after stages already listed, so the plan reads top to bottom and cannot loop.
    const after = list(raw.after).map((item) => text(item));
    for (const earlier of after) {
      if (!stageKeys.has(earlier))
        problems.push(
          `${where} comes after ${earlier || 'nothing'}, which is not a stage above it.`,
        );
    }
    if (index === 0 && after.length > 0) problems.push('The first stage comes after nothing.');
    if (index > 0 && after.length === 0)
      problems.push(
        `${where} names no stage it comes after; only the first stage starts the course.`,
      );
    stageKeys.add(key);

    const steps: Step[] = [];
    list(raw.steps).forEach((item, at) => {
      const spot = `${where}, step ${at + 1}`;
      if (!isObject(item)) return void problems.push(`${spot} is not an object.`);
      const blocks: Block[] = [];
      let seconds = 0;
      let read = 0;
      list(item.blocks).forEach((block, n) => {
        const here = `${spot}, block ${n + 1}`;
        if (!isObject(block)) return void problems.push(`${here} is not an object.`);
        const type = text(block.type);
        if (type === 'text') {
          const body = prose(block.body, `${here} body`);
          read += words(body);
          blocks.push({ type, title: prose(block.title, `${here} title`, false) || null, body });
        } else if (type === 'clip') {
          const start = time(block.start);
          const end = time(block.end);
          if (end === null) return void problems.push(`${here} is a clip with no end.`);
          if (!inside(text(block.code), start, end, here) || start === null) return;
          seconds += end - start;
          blocks.push({
            type,
            code: text(block.code),
            start,
            end,
            // Worked out here, so a step's minutes cannot disagree with its clips.
            minutes: Math.max(1, Math.round((end - start) / 60)),
            listenFor: prose(block.listenFor, `${here} listenFor`),
          });
        } else if (type === 'figure') {
          const svg = typeof block.svg === 'string' ? block.svg.trim() : '';
          for (const problem of svgProblems(svg)) problems.push(`${here}: ${problem}`);
          blocks.push({ type, caption: prose(block.caption, `${here} caption`), svg });
        } else if (type === 'reading') {
          const excerpt = list(block.excerpt)
            .map((paragraph) => text(paragraph))
            .filter(Boolean);
          const licence = text(block.licence) || null;
          if (excerpt.length > 0 && !licence)
            problems.push(`${here} shows the author's text without naming its open licence.`);
          const url = text(block.url) || null;
          if (url && !/^https:\/\/[^\s]+$/.test(url))
            problems.push(`${here} has a link that is not https.`);
          if (url && /(youtube\.com|youtu\.be)/.test(url))
            problems.push(`${here} links a video; a video is a clip block.`);
          const body = prose(block.body, `${here} body`);
          read += words(body) + words(excerpt.join(' '));
          blocks.push({
            type,
            title: prose(block.title, `${here} title`),
            author: text(block.author) || null,
            source: text(block.source) || null,
            url,
            body,
            excerpt,
            licence,
          });
        } else if (type === 'check') {
          blocks.push({
            type,
            question: prose(block.question, `${here} question`),
            answer: prose(block.answer, `${here} answer`),
          });
        } else {
          problems.push(`${here} has no type (text, clip, figure, reading or check).`);
        }
      });
      if (!blocks.some((block) => block.type === 'text'))
        problems.push(`${spot} has no commentary; every step says in words what it is for.`);
      watchSeconds += seconds;
      const minutes = Math.max(1, Math.round(seconds / 60 + read / 230));
      if (minutes < MIN_STEP_MINUTES)
        problems.push(
          `${spot} is ${minutes} min, too short to be a sitting; fold it into the step beside it.`,
        );
      const gain = prose(item.gain, `${spot} gain`);
      if (gain.length > 140)
        problems.push(`${spot} gain runs ${gain.length} characters; keep it to 140.`);
      steps.push({
        key: `${key}.${at + 1}`,
        title: prose(item.title, `${spot} title`),
        gain: gain || null,
        minutes,
        blocks,
      });
    });
    if (steps.length === 0) problems.push(`${where} has no steps.`);
    const short = prose(raw.short, `${where} short name`);
    if (short.length > 24)
      problems.push(
        `${where} short name runs ${short.length} characters; the map has room for 24.`,
      );
    stages.push({
      key,
      title: prose(raw.title, `${where} title`),
      short,
      about: prose(raw.about, `${where} about`),
      after,
      steps,
    });
  });
  if (stages.length === 0) problems.push('The plan has no stages.');
  // The keys are the plan's own bookkeeping. The reader sees names, so prose
  // that points at "stage B2" or "step C.3" points at nothing on the page.
  const codes = [...stageKeys].map((key) => key.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
  if (codes.length > 0) {
    const named = new RegExp(
      `\\b(?:stages?|steps?)\\s+(?:${codes.join('|')})(?:\\.\\d+)?\\b|\\b(?:${codes.join('|')})\\.\\d+\\b`,
    );
    for (const [where, body] of written) {
      const found = body.replace(/\[\[[^\]]*\]\]/g, '').match(named);
      if (found)
        problems.push(`${where} names "${found[0]}"; call a stage or a step by its title.`);
    }
  }
  const watchMinutes = Math.round(watchSeconds / 60);
  if (watchMinutes > budgetMinutes * 1.1)
    problems.push(
      `The plan's clips run ${watchMinutes} minutes against a budget of ${budgetMinutes}.`,
    );

  const ratings = isObject(input.ratings) ? input.ratings : {};
  const rated = new Set<string>();
  const ratingRows = list(ratings.rows).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    const code = text(raw.code);
    const where = `Rating ${index + 1} (${code || 'no code'})`;
    if (!byCode.has(code)) problems.push(`${where} names a lecture the course does not have.`);
    if (rated.has(code)) problems.push(`${where} rates ${code} twice.`);
    rated.add(code);
    const rating = text(raw.rating) as Rating;
    if (!RATINGS.includes(rating))
      problems.push(`${where} has no rating (watch, parts, skim or skip).`);
    return [
      {
        code,
        rating,
        watch: prose(raw.watch, `${where} what to watch`, false),
        why: prose(raw.why, `${where} why`),
      },
    ];
  });
  // D4: the digest is built from every lecture, never a sample.
  for (const lecture of lectures) {
    if (!rated.has(lecture.code))
      problems.push(`Lecture ${lecture.code} has no rating; every lecture gets one.`);
  }

  const ideas = list(input.ideas).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    return [
      {
        title: prose(raw.title, `Idea ${index + 1} title`),
        body: prose(raw.body, `Idea ${index + 1}`),
      },
    ];
  });
  if (ideas.length < 5) problems.push(`The digest has ${ideas.length} big ideas; write about ten.`);

  const errors = isObject(input.errors) ? input.errors : {};
  const errorRows = list(errors.rows).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    const where = `Error ${index + 1}`;
    return [
      {
        where: prose(raw.where, `${where} where`),
        said: prose(raw.said, `${where} what was said`),
        correction: prose(raw.correction, `${where} correction`),
      },
    ];
  });
  const digest: Digest = {
    madeFor: prose(input.madeFor, 'madeFor'),
    intro: prose(input.intro, 'intro'),
    plan: { intro: prose(planIn.intro, 'Plan intro', false), budgetMinutes, stages },
    ratings: { intro: prose(ratings.intro, 'Ratings intro', false), rows: ratingRows },
    ideas,
    errors: { intro: prose(errors.intro, 'Errors intro', false), rows: errorRows },
  };
  return problems.length > 0 ? { ok: false, problems } : { ok: true, digest };
}

/** Read lectures a session listed; the same checks whether they come from a file or the database. */
export function checkLectures(
  input: unknown,
): { ok: true; lectures: Lecture[] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const codes = new Set<string>();
  const ids = new Set<string>();
  const lectures: Lecture[] = [];
  list(input).forEach((raw, index) => {
    const where = `Lecture ${index + 1}`;
    if (!isObject(raw)) return void problems.push(`${where} is not an object.`);
    const code = text(raw.code);
    const videoId = text(raw.videoId);
    const durationSeconds = time(raw.durationSeconds ?? raw.duration);
    if (!/^[A-Za-z]{1,3}\d{1,3}$/.test(code)) problems.push(`${where} needs a code like L07.`);
    if (codes.has(code)) problems.push(`${where} repeats the code ${code}.`);
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId))
      problems.push(`${where} (${code}) has no YouTube video id.`);
    if (ids.has(videoId)) problems.push(`${where} (${code}) repeats a video.`);
    if (!durationSeconds) problems.push(`${where} (${code}) has no length.`);
    if (!text(raw.title)) problems.push(`${where} (${code}) has no title.`);
    codes.add(code);
    ids.add(videoId);
    lectures.push({
      code,
      title: text(raw.title),
      videoId,
      durationSeconds: durationSeconds ?? 0,
      speaker: text(raw.speaker) || null,
    });
  });
  if (lectures.length === 0) problems.push('No lectures were listed.');
  return problems.length > 0 ? { ok: false, problems } : { ok: true, lectures };
}

/** What a digest comes to, for the course's row and its page header. */
export function digestTotals(digest: Digest, lectures: readonly Lecture[]) {
  const runtimeMinutes = Math.round(
    lectures.reduce((sum, lecture) => sum + lecture.durationSeconds, 0) / 60,
  );
  const steps = digest.plan.stages.flatMap((stage) => stage.steps);
  // Every step of every branch: the whole plan, watched and read.
  const pathMinutes = steps.reduce((sum, step) => sum + step.minutes, 0);
  const watchMinutes = steps
    .flatMap((step) => step.blocks)
    .reduce((sum, block) => sum + (block.type === 'clip' ? block.minutes : 0), 0);
  const count = (rating: Rating) =>
    digest.ratings.rows.filter((row) => row.rating === rating).length;
  return {
    runtimeMinutes,
    pathMinutes,
    watchMinutes,
    stages: digest.plan.stages.length,
    steps: steps.length,
    share: runtimeMinutes > 0 ? watchMinutes / runtimeMinutes : 0,
    watch: count('watch'),
    parts: count('parts'),
    skim: count('skim'),
    skip: count('skip'),
  };
}

/**
 * A course digest: a long lecture series cut down to what one person needs
 * (docs/LEARN-DIGEST-SPEC.md). This file is the contract between the session
 * that writes a digest (.claude/skills/learn-courses/SKILL.md) and the pages
 * that draw it: the shape, and the checks a digest must pass before it is
 * kept.
 *
 * Text fields are markdown. A moment in a lecture is written as a token,
 * `[[L07 21:49]]` or `[[L07 21:49-29:39]]`, never as a URL: the link is built
 * from the lecture's stored video id (rule D2), and a token naming a lecture
 * the course lacks, or a time past its end, fails the check.
 */

export const TREATMENTS = ['clip', 'worked', 'card', 'skip'] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const RATINGS = ['watch', 'parts', 'skim', 'skip'] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABEL: Record<Rating, string> = {
  watch: 'Watch whole',
  parts: 'Watch parts',
  skim: 'Skim',
  skip: 'Skip',
};

export const TREATMENT_LABEL: Record<Treatment, string> = {
  clip: 'Clip',
  worked: 'Worked example',
  card: 'Card',
  skip: 'Skipped',
};

export type Lecture = {
  /** Short and unique in the course: L07, P09, K03. */
  code: string;
  title: string;
  videoId: string;
  durationSeconds: number;
  speaker: string | null;
};

export type Clip = {
  code: string;
  /** Seconds from the start of the lecture. */
  start: number;
  end: number | null;
  /** What to listen for, in one sentence. */
  listenFor: string;
};

export type Idea = {
  name: string;
  treatment: Treatment;
  /** The explanation: a mechanism with numbers, one sentence for a card, the reason for a skip. */
  body: string;
  clips: Clip[];
};

export type Lesson = {
  key: string;
  title: string;
  /** The point of the cluster, in one sentence with its number. */
  point: string;
  ideas: Idea[];
  check: { question: string; answer: string } | null;
  /** Who disagrees inside the series about this cluster, and where it lands. */
  tension: string | null;
};

export type PathClip = {
  code: string;
  start: number;
  end: number;
  minutes: number;
  /** What the learner gets from it. */
  get: string;
};

export type Digest = {
  /** Who this was cut for and to what end, in a sentence or two. */
  madeFor: string;
  /** How to use it: what was read, what the codes mean. */
  intro: string;
  lessons: Lesson[];
  dependencies: { intro: string; tracks: { title: string; steps: string[] }[] };
  tensions: {
    intro: string;
    rows: { tension: string; oneSide: string; otherSide: string; lands: string }[];
    outro: string | null;
  };
  ratings: { intro: string; rows: { code: string; rating: Rating; watch: string; why: string }[] };
  ideas: { title: string; body: string }[];
  path: { intro: string; budgetMinutes: number; clips: PathClip[] };
  errors: { intro: string; rows: { where: string; said: string; correction: string }[] };
};

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
export function linkMoments(text: string, lectures: readonly Lecture[]): string {
  const byCode = new Map(lectures.map((lecture) => [lecture.code, lecture]));
  return text.replace(TOKEN, (raw, code: string, from: string, to: string | undefined) => {
    const lecture = byCode.get(code);
    const start = secondsOf(from);
    if (!lecture || start === null) return `${code} ${from}`;
    const label = to ? `${code} ${from} to ${to}` : `${code} ${from}`;
    return `[${label}](${watchUrl(lecture.videoId, start)})`;
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

  const prose = (value: unknown, where: string, required = true): string => {
    const body = text(value);
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

  const lessons: Lesson[] = [];
  const keys = new Set<string>();
  list(input.lessons).forEach((raw, index) => {
    const where = `Lesson ${index + 1}`;
    if (!isObject(raw)) return void problems.push(`${where} is not an object.`);
    const key = text(raw.key) || String.fromCharCode(65 + index);
    if (keys.has(key)) problems.push(`${where} repeats the key ${key}.`);
    keys.add(key);
    const ideas: Idea[] = [];
    list(raw.ideas).forEach((item, at) => {
      const spot = `${where}, idea ${at + 1}`;
      if (!isObject(item)) return void problems.push(`${spot} is not an object.`);
      const treatment = text(item.treatment) as Treatment;
      if (!TREATMENTS.includes(treatment))
        problems.push(`${spot} has no treatment (clip, worked, card or skip).`);
      const clips: Clip[] = [];
      list(item.clips).forEach((clip, n) => {
        const here = `${spot}, clip ${n + 1}`;
        if (!isObject(clip)) return void problems.push(`${here} is not an object.`);
        const start = time(clip.start);
        const end = clip.end === undefined || clip.end === null ? null : time(clip.end);
        if (inside(text(clip.code), start, end, here) && start !== null) {
          clips.push({
            code: text(clip.code),
            start,
            end,
            listenFor: prose(clip.listenFor, `${here} listenFor`, false),
          });
        }
      });
      if (treatment === 'clip' && clips.length === 0)
        problems.push(`${spot} is a clip with no clip.`);
      ideas.push({
        name: prose(item.name, `${spot} name`),
        treatment,
        body: prose(item.body, `${spot} body`),
        clips,
      });
    });
    if (ideas.length === 0) problems.push(`${where} has no ideas.`);
    const check = isObject(raw.check)
      ? {
          question: prose(raw.check.question, `${where} check question`),
          answer: prose(raw.check.answer, `${where} check answer`),
        }
      : null;
    lessons.push({
      key,
      title: prose(raw.title, `${where} title`),
      point: prose(raw.point, `${where} point`),
      ideas,
      check,
      tension: prose(raw.tension, `${where} tension`, false) || null,
    });
  });
  if (lessons.length === 0) problems.push('The digest has no lessons.');

  const dependencies = isObject(input.dependencies) ? input.dependencies : {};
  const tracks = list(dependencies.tracks).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    const steps = list(raw.steps).map((step, at) =>
      prose(step, `Dependency track ${index + 1}, step ${at + 1}`),
    );
    return [{ title: prose(raw.title, `Dependency track ${index + 1} title`), steps }];
  });

  const tensions = isObject(input.tensions) ? input.tensions : {};
  const tensionRows = list(tensions.rows).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    const where = `Tension ${index + 1}`;
    return [
      {
        tension: prose(raw.tension, `${where}`),
        oneSide: prose(raw.oneSide, `${where} one side`),
        otherSide: prose(raw.otherSide, `${where} other side`),
        lands: prose(raw.lands, `${where} where it lands`),
      },
    ];
  });

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

  const path = isObject(input.path) ? input.path : {};
  const budgetMinutes =
    typeof path.budgetMinutes === 'number' && path.budgetMinutes > 0
      ? Math.round(path.budgetMinutes)
      : 180;
  const pathClips: PathClip[] = [];
  list(path.clips).forEach((raw, index) => {
    const where = `Path clip ${index + 1}`;
    if (!isObject(raw)) return void problems.push(`${where} is not an object.`);
    const start = time(raw.start);
    const end = time(raw.end);
    if (end === null) return void problems.push(`${where} has no end.`);
    if (!inside(text(raw.code), start, end, where) || start === null) return;
    // The minutes are worked out here, so the column and its total cannot disagree with the clips.
    pathClips.push({
      code: text(raw.code),
      start,
      end,
      minutes: Math.max(1, Math.round((end - start) / 60)),
      get: prose(raw.get, `${where} what you get`),
    });
  });
  if (pathClips.length === 0) problems.push('The path has no clips.');
  const total = pathClips.reduce((sum, clip) => sum + clip.minutes, 0);
  if (total > budgetMinutes * 1.1)
    problems.push(`The path runs ${total} minutes against a budget of ${budgetMinutes}.`);

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
    lessons,
    dependencies: { intro: prose(dependencies.intro, 'Dependencies intro', false), tracks },
    tensions: {
      intro: prose(tensions.intro, 'Tensions intro', false),
      rows: tensionRows,
      outro: prose(tensions.outro, 'Tensions outro', false) || null,
    },
    ratings: { intro: prose(ratings.intro, 'Ratings intro', false), rows: ratingRows },
    ideas,
    path: { intro: prose(path.intro, 'Path intro', false), budgetMinutes, clips: pathClips },
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
  const pathMinutes = digest.path.clips.reduce((sum, clip) => sum + clip.minutes, 0);
  const count = (rating: Rating) =>
    digest.ratings.rows.filter((row) => row.rating === rating).length;
  return {
    runtimeMinutes,
    pathMinutes,
    share: runtimeMinutes > 0 ? pathMinutes / runtimeMinutes : 0,
    watch: count('watch'),
    parts: count('parts'),
    skim: count('skim'),
    skip: count('skip'),
  };
}

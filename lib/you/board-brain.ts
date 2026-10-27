/**
 * The shape of an advisor's brain (plan #2581.4), the jsonb in
 * you.board_advisors.brain that .claude/skills/board/advisor-brain.md writes
 * and the board briefs each advisor with. Version 2 adds what keeps a persona
 * from collapsing into its stereotype: the one assessment the advisor owns,
 * signature questions, the evidence it asks for first, where it rejects the
 * usual view, named disagreements with other advisors, and what it would
 * never say. Seats have brains too, built from the literature on their role.
 *
 * checkBrain is the skill's step 4: every count the skill asks for, so a
 * session builds against the same rules a test holds. readBrain is the
 * forgiving reader for pages that show a brain, version 1 included.
 */

export type BrainSource = { label: string; link: string };

export type Brain = {
  version: number;
  assessment: { name: string; text: string } | null;
  evidence: string[];
  questions: string[];
  rules: string[];
  frameworks: { name: string; text: string }[];
  positions: { topic: string; text: string }[];
  contrarian: { common: string; text: string }[];
  disagreements: { advisor: string; text: string }[];
  stories: { date: string | null; text: string; source: string }[];
  never: string[];
  voice: string;
  sources: BrainSource[];
};

/** How many of each part a version 2 brain holds, as [least, most]. */
export const BRAIN_COUNTS = {
  evidence: [2, 4],
  questions: [3, 5],
  rules: [8, 8],
  frameworks: [3, 6],
  positions: [4, 8],
  contrarian: [2, 4],
  disagreements: [2, 4],
  stories: [3, 5],
  never: [3, 5],
} as const;

export const MIN_SOURCES = 10;
/** The dreamer's brain is grounded in the person's own notes: at least this many of its sources are notes. */
export const MIN_DREAMER_NOTES = 4;

const SEAT_KEYS = ['hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer'] as const;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const texts = (value: unknown): string[] => list(value).map(str).filter(Boolean);

function pairs<K extends string>(value: unknown, a: K, b: 'text'): ({ [P in K]: string } & { text: string })[] {
  return list(value).flatMap((item) => {
    const o = obj(item);
    const first = str(o?.[a]);
    const text = str(o?.[b]);
    return first && text ? [{ [a]: first, text } as { [P in K]: string } & { text: string }] : [];
  });
}

const isWebLink = (link: string): boolean => /^https?:\/\/\S+$/.test(link);
const isNoteLink = (link: string): boolean => /^\/vault\/n\/\S+$/.test(link);

/** A brain as a page can show it, whatever version wrote it; null when there is none (or only a failure). */
export function readBrain(value: unknown): Brain | null {
  const b = obj(value);
  if (!b || (!Array.isArray(b.rules) && !Array.isArray(b.sources))) return null;
  const assessment = obj(b.assessment);
  return {
    version: typeof b.version === 'number' ? b.version : 1,
    assessment:
      assessment && str(assessment.name) && str(assessment.text)
        ? { name: str(assessment.name), text: str(assessment.text) }
        : null,
    evidence: texts(b.evidence),
    questions: texts(b.questions),
    rules: texts(b.rules),
    frameworks: pairs(b.frameworks, 'name', 'text'),
    positions: pairs(b.positions, 'topic', 'text'),
    contrarian: pairs(b.contrarian, 'common', 'text'),
    disagreements: pairs(b.disagreements, 'advisor', 'text'),
    stories: list(b.stories).flatMap((item) => {
      const o = obj(item);
      const text = str(o?.text);
      return text ? [{ date: str(o?.date) || null, text, source: str(o?.source) }] : [];
    }),
    never: texts(b.never),
    voice: str(b.voice),
    sources: list(b.sources).flatMap((item) => {
      const o = obj(item);
      const label = str(o?.label);
      const link = str(o?.link);
      return label && link ? [{ label, link }] : [];
    }),
  };
}

/**
 * Every way a version 2 brain falls short of advisor-brain.md, step 4, as
 * sentences; an empty list means it may be written. `key` is the advisor's
 * own key and `roster` the other advisors' keys on the person's board.
 */
export function checkBrain(value: unknown, input: { key: string; roster: readonly string[] }): string[] {
  const problems: string[] = [];
  const raw = obj(value);
  if (!raw) return ['The brain is not an object.'];
  if (raw.version !== 2) problems.push('version is not 2.');
  const brain = readBrain(raw);
  if (!brain) return [...problems, 'The brain has no rules or sources.'];

  if (!brain.assessment) problems.push('assessment needs a name and a text.');

  for (const [part, [least, most]] of Object.entries(BRAIN_COUNTS) as [keyof typeof BRAIN_COUNTS, readonly [number, number]][]) {
    const given = list(raw[part]).length;
    const kept = brain[part].length;
    if (kept !== given) problems.push(`${part} has ${given - kept} entr${given - kept === 1 ? 'y' : 'ies'} missing a field.`);
    if (kept < least || kept > most) {
      problems.push(`${part} has ${kept}; it needs ${least === most ? least : `${least} to ${most}`}.`);
    }
  }

  brain.rules.forEach((rule, i) => {
    if (!/\([^()]+\)[.]?$/.test(rule)) problems.push(`rule ${i + 1} does not end with its source in brackets.`);
  });

  if (!brain.voice) problems.push('voice is empty.');

  const isSeat = (SEAT_KEYS as readonly string[]).includes(input.key);
  const dreamer = input.key === 'dreamer';
  const links = new Set<string>();
  brain.sources.forEach((s, i) => {
    if (!(isWebLink(s.link) || (dreamer && isNoteLink(s.link)))) {
      problems.push(`source ${i + 1} (${s.label}) has no usable link.`);
    }
    if (links.has(s.link)) problems.push(`source ${s.link} is listed twice.`);
    links.add(s.link);
  });
  if (brain.sources.length < MIN_SOURCES) {
    problems.push(`sources has ${brain.sources.length}; it needs at least ${MIN_SOURCES}.`);
  }
  if (dreamer) {
    const notes = brain.sources.filter((s) => isNoteLink(s.link)).length;
    if (notes < MIN_DREAMER_NOTES) problems.push(`the dreamer cites ${notes} notes; it needs at least ${MIN_DREAMER_NOTES}.`);
  }

  brain.stories.forEach((story, i) => {
    if (!story.date) problems.push(`story ${i + 1} has no date.`);
    if (!links.has(story.source)) problems.push(`story ${i + 1}'s source is not in sources.`);
  });

  const others = new Set(input.roster.filter((k) => k !== input.key));
  brain.disagreements.forEach((d, i) => {
    if (d.advisor === input.key) problems.push(`disagreement ${i + 1} is with this advisor itself.`);
    else if (!others.has(d.advisor)) problems.push(`disagreement ${i + 1} names ${d.advisor}, who is not on the board.`);
  });
  if (!isSeat && brain.disagreements.length > 0 && !brain.disagreements.some((d) => (SEAT_KEYS as readonly string[]).includes(d.advisor))) {
    problems.push('no disagreement is with a seat; a guest needs at least one.');
  }

  return problems;
}

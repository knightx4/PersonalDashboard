/**
 * A prepared source: something to read, with the help attached to it
 * (docs/LEARN-READER-SPEC.md). This file is the contract between the session
 * that prepares a source (.claude/skills/learn-reader/SKILL.md) and the pages
 * that draw it: the shape, and the checks a source must pass before it is
 * kept.
 *
 * The text is the author's, word for word. Where the full text is given to
 * the check, every paragraph has to be found in it, so a session cannot type
 * a passage from memory and present it as the source. A note on a phrase
 * names words that are in its section, or it is refused.
 */

export const BASES = ['text', 'read', 'memory'] as const;
/** What the summaries rest on: the text shown here, a text read but not shown, or knowledge of the work. */
export type Basis = (typeof BASES)[number];

export type Figure = { caption: string; svg: string };
export type Gloss = { phrase: string; note: string };
export type Question = { question: string; answer: string };

export type Section = {
  title: string;
  minutes: number;
  /** Where it is in a printed copy, when known: "pp. 30 to 41". */
  pages: string | null;
  /** Where the reader is in the argument as the section opens. */
  context: string;
  summary: string;
  /** The one idea of the section, in a sentence. */
  idea: string;
  /** The author's paragraphs, or null when the text may not be shown. */
  text: string[] | null;
  glosses: Gloss[];
  questions: Question[];
  figure: Figure | null;
};

export type PreparedSource = {
  title: string;
  author: string;
  published: string | null;
  kind: 'text' | 'video';
  rights: 'open' | 'copyright';
  minutes: number;
  /** Who wrote it, when, and against what. Read before anything else. */
  context: string;
  /** The whole work in a few sentences. */
  brief: string;
  /** The one idea to take away. */
  idea: string;
  figure: Figure | null;
  sections: Section[];
};

const SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
]);
const SVG_ATTRIBUTES = new Set([
  'viewBox',
  'xmlns',
  'role',
  'aria-label',
  'aria-hidden',
  'class',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'dx',
  'dy',
  'width',
  'height',
  'points',
  'transform',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-weight',
  'font-style',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
]);
const SVG_CLASSES = new Set(['accent', 'muted', 'soft']);

/**
 * What is wrong with a figure's drawing, as a list. A figure is drawn into
 * the page as it is written, so it may hold shapes and words and nothing
 * else: no script, no link, no style, no colour of its own.
 */
export function svgProblems(svg: string): string[] {
  const problems: string[] = [];
  const body = svg.trim();
  if (!/^<svg[\s>]/.test(body) || !body.endsWith('</svg>')) return ['is not one <svg> element'];
  if (/<!|<\?|&#|javascript:|url\(/i.test(body))
    problems.push('holds something other than shapes and words');
  if (!/viewBox="[-\d.\s]+"/.test(body)) problems.push('has no viewBox');
  for (const tag of body.matchAll(/<\/?([A-Za-z][\w:-]*)([^>]*)>/g)) {
    const name = tag[1];
    if (!SVG_ELEMENTS.has(name)) {
      problems.push(`uses <${name}>`);
      continue;
    }
    for (const attribute of tag[2].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
      const [, key, value] = attribute;
      if (!SVG_ATTRIBUTES.has(key)) problems.push(`sets ${key} on <${name}>`);
      else if ((key === 'fill' || key === 'stroke') && value !== 'none' && value !== 'currentColor')
        problems.push(`gives ${key} a colour of its own (${value})`);
      else if (key === 'class' && !value.split(/\s+/).every((item) => SVG_CLASSES.has(item)))
        problems.push(`uses the class ${value}`);
    }
    if (/=\s*'/.test(tag[2])) problems.push(`quotes an attribute of <${name}> with single quotes`);
  }
  return [...new Set(problems)];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** Whitespace and typographic quotes aside, the same words. */
const plain = (value: string): string =>
  value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

export type SourceCheck = { ok: true; source: PreparedSource } | { ok: false; problems: string[] };

/**
 * Read what a session wrote as a prepared source and check it. `fullText` is
 * the cleaned text the paragraphs were taken from; with it, every paragraph
 * must be found there.
 */
export function checkSource(input: unknown, fullText: string | null = null): SourceCheck {
  const problems: string[] = [];
  if (!isObject(input)) return { ok: false, problems: ['The source is not an object.'] };
  const whole = fullText ? plain(fullText) : null;

  const written = (
    value: unknown,
    where: string,
    options: { required?: boolean; max?: number } = {},
  ): string => {
    const body = text(value);
    if (!body && options.required !== false) problems.push(`${where} is empty.`);
    if (body.includes('—')) problems.push(`${where} has an em dash.`);
    if (/https?:\/\//.test(body)) problems.push(`${where} has a typed link.`);
    if (options.max && body.length > options.max)
      problems.push(`${where} is ${body.length} characters; keep it to ${options.max}.`);
    return body;
  };

  const figure = (value: unknown, where: string): Figure | null => {
    if (value === null || value === undefined) return null;
    if (!isObject(value)) {
      problems.push(`${where} is not an object.`);
      return null;
    }
    const svg = text(value.svg);
    for (const problem of svgProblems(svg)) problems.push(`${where} ${problem}.`);
    return { caption: written(value.caption, `${where} caption`), svg };
  };

  const rights = text(input.rights) === 'open' ? 'open' : 'copyright';
  let figures = 0;
  const sections: Section[] = [];
  list(input.sections).forEach((raw, index) => {
    const where = `Section ${index + 1}`;
    if (!isObject(raw)) return void problems.push(`${where} is not an object.`);
    const paragraphs =
      raw.text === null || raw.text === undefined
        ? null
        : list(raw.text)
            .map((item) => text(item))
            .filter(Boolean);
    if (paragraphs && paragraphs.length === 0)
      problems.push(
        `${where} has a text with no paragraphs; give null when the text is not shown.`,
      );
    if (paragraphs && rights !== 'open')
      problems.push(`${where} shows text of a work that is not marked open.`);
    if (!paragraphs && rights === 'open')
      problems.push(`${where} has no text, and an open work is shown in full.`);
    if (paragraphs && whole) {
      paragraphs.forEach((paragraph, at) => {
        if (!whole.includes(plain(paragraph)))
          problems.push(
            `${where}, paragraph ${at + 1} is not in the full text: "${paragraph.slice(0, 60)}…"`,
          );
      });
    }
    const body = paragraphs ? plain(paragraphs.join('\n')) : '';
    const glosses: Gloss[] = [];
    list(raw.glosses).forEach((item, at) => {
      const spot = `${where}, note ${at + 1}`;
      if (!isObject(item)) return void problems.push(`${spot} is not an object.`);
      const phrase = text(item.phrase);
      if (!paragraphs) return void problems.push(`${spot} is on a section with no text.`);
      if (!phrase || !body.includes(plain(phrase)))
        problems.push(`${spot} names "${phrase}", which is not in the section's text.`);
      if (glosses.some((other) => other.phrase.includes(phrase) || phrase.includes(other.phrase)))
        problems.push(`${spot} overlaps another note ("${phrase}").`);
      glosses.push({ phrase, note: written(item.note, `${spot}`) });
    });
    const questions = list(raw.questions).flatMap((item, at) => {
      if (!isObject(item)) return [];
      return [
        {
          question: written(item.question, `${where}, question ${at + 1}`),
          answer: written(item.answer, `${where}, answer ${at + 1}`),
        },
      ];
    });
    const drawn = figure(raw.figure, `${where} figure`);
    if (drawn) figures += 1;
    const minutes =
      typeof raw.minutes === 'number' && raw.minutes > 0 ? Math.round(raw.minutes) : 0;
    if (!minutes) problems.push(`${where} has no minutes.`);
    sections.push({
      title: written(raw.title, `${where} title`, { max: 120 }),
      minutes,
      pages: written(raw.pages, `${where} pages`, { required: false }) || null,
      context: written(raw.context, `${where} context`),
      summary: written(raw.summary, `${where} summary`),
      idea: written(raw.idea, `${where} idea`, { max: 200 }),
      text: paragraphs,
      glosses,
      questions,
      figure: drawn,
    });
  });
  if (sections.length === 0) problems.push('The source has no sections.');

  const top = figure(input.figure, 'The figure');
  if (top) figures += 1;
  if (figures > 4)
    problems.push(`The source has ${figures} figures; keep the three or four that explain most.`);

  const source: PreparedSource = {
    title: written(input.title, 'title', { max: 300 }),
    author: written(input.author, 'author'),
    published: written(input.published, 'published', { required: false }) || null,
    kind: text(input.kind) === 'video' ? 'video' : 'text',
    rights,
    minutes: sections.reduce((sum, section) => sum + section.minutes, 0),
    context: written(input.context, 'context'),
    brief: written(input.brief, 'brief'),
    idea: written(input.idea, 'idea', { max: 200 }),
    figure: top,
    sections,
  };
  return problems.length > 0 ? { ok: false, problems } : { ok: true, source };
}

export type TextPart = { text: string } | { text: string; gloss: number };

/**
 * A paragraph cut at the phrases its section has notes on, each note used
 * once in the section. `used` carries which notes earlier paragraphs took.
 */
export function partsOf(
  paragraph: string,
  glosses: readonly Gloss[],
  used: Set<number>,
): TextPart[] {
  let parts: TextPart[] = [{ text: paragraph }];
  glosses.forEach((gloss, index) => {
    if (used.has(index) || !gloss.phrase) return;
    for (let at = 0; at < parts.length; at += 1) {
      const part = parts[at];
      if ('gloss' in part) continue;
      const found = part.text.indexOf(gloss.phrase);
      if (found < 0) continue;
      used.add(index);
      parts = [
        ...parts.slice(0, at),
        { text: part.text.slice(0, found) },
        { text: gloss.phrase, gloss: index },
        { text: part.text.slice(found + gloss.phrase.length) },
        ...parts.slice(at + 1),
      ].filter((item) => item.text.length > 0);
      return;
    }
  });
  return parts;
}

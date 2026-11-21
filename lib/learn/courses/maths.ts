/**
 * The formulas in a course written with them (`Digest.maths`), checked before
 * a stage is kept: every one must set in KaTeX the way the page will set it,
 * and none may leak into a field the page shows as plain text. A formula that
 * does not parse shows the learner raw markup, and a stray dollar sign turns
 * the rest of a paragraph into maths. Used by scripts/learn-course.ts, not by
 * the pages, so KaTeX stays off the client.
 */
import katex from 'katex';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

function parses(tex: string, display: boolean): string | null {
  try {
    katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore' });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 120) : 'does not parse';
  }
}

/** Problems with the formulas in one piece of text the page sets as markdown with maths. */
export function formulaProblems(body: string): string[] {
  const problems: string[] = [];
  let rest = body.replace(/`[^`]*`/g, '');
  rest = rest.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
    const failed = parses(tex, true);
    if (failed) problems.push(`a display formula does not parse: ${failed}`);
    return ' ';
  });
  rest = rest.replace(/\$([^$\n]+?)\$/g, (_, tex: string) => {
    // The page reads `$…$` the vault's way: a space before the closing sign makes it plain text.
    if (/\s$/.test(tex))
      problems.push(
        `an inline formula ends in a space, so it will not be set: $${tex.slice(0, 50)}$`,
      );
    const failed = parses(tex, false);
    if (failed)
      problems.push(`an inline formula does not parse: $${tex.slice(0, 50)}$ (${failed})`);
    return ' ';
  });
  if (rest.includes('$')) {
    const at = rest.indexOf('$');
    problems.push(`a stray dollar sign: …${rest.slice(Math.max(0, at - 40), at + 40)}…`);
  }
  const loose = rest.match(/.{0,30}\\(begin|frac|sqrt|lambda|sigma|cdot|times|log|sum)\b.{0,30}/);
  if (loose) problems.push(`LaTeX outside a formula: ${loose[0]}`);
  return problems;
}

/** Plain text the page shows as written: no formula and no LaTeX command. */
function plainProblems(value: string): string[] {
  return /\$|\\[a-zA-Z]+/.test(value)
    ? [`LaTeX or a dollar sign in plain text: ${value.slice(0, 80)}`]
    : [];
}

/** Every formula problem in a stage, each with where it is. */
export function stageMathsProblems(stage: unknown): string[] {
  if (!isObject(stage)) return [];
  const problems: string[] = [];
  const add = (where: string, found: string[]) =>
    found.forEach((p) => problems.push(`${where}: ${p}`));
  add('stage title', plainProblems(text(stage.title)));
  add('stage about', plainProblems(text(stage.about)));
  add('stage short name', plainProblems(text(stage.short)));
  list(stage.steps).forEach((step, i) => {
    if (!isObject(step)) return;
    const where = `step ${i + 1}`;
    add(`${where} title`, plainProblems(text(step.title)));
    add(`${where} gain`, plainProblems(text(step.gain)));
    list(step.blocks).forEach((block, j) => {
      if (!isObject(block)) return;
      const here = `${where}, block ${j + 1} (${text(block.type)})`;
      if (block.type === 'text') {
        add(`${here} title`, plainProblems(text(block.title)));
        add(here, formulaProblems(text(block.body)));
      }
      if (block.type === 'check') {
        add(`${here} question`, formulaProblems(text(block.question)));
        add(`${here} answer`, formulaProblems(text(block.answer)));
      }
      if (block.type === 'reading') add(here, formulaProblems(text(block.body)));
      if (block.type === 'clip') add(`${here} listenFor`, plainProblems(text(block.listenFor)));
      if (block.type === 'figure') {
        add(`${here} caption`, plainProblems(text(block.caption)));
        if (text(block.svg).includes('$')) problems.push(`${here}: a dollar sign in the drawing`);
      }
    });
  });
  return problems;
}

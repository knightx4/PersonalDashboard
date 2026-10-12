/**
 * The writing guide check, the one local check (plan #1869): the rules in
 * lib/writing/check.ts run over the draft, costing nothing. Its notes open
 * as a marker alone (rung 0), and Help climbs the ladder written here for
 * each pattern the rules can find. Kept apart from checks.ts so the page
 * does not load the writing check.
 */

import { ruleScores, WRITING_PATTERNS, type WritingPattern } from '@/lib/writing/check';
import { makeAnchor } from './anchor';
import { essayParagraphs, PARAGRAPHS_MAX, type Finding, type Paragraph } from './checks';

/** What the writing guide check says about each pattern its rules can find. */
const GUIDE_LADDERS: Partial<Record<WritingPattern, { ladder: [string, string, string]; why: string }>> = {
  inflated_contrast: {
    ladder: [
      'Is this sentence making its point sound bigger than it is?',
      'It sets the point against something nobody said ("not X, it\'s Y"), which the writing guide calls inflated contrast.',
      'Say the point plainly. Keep the contrast only if someone really does think the other thing, and say who.',
    ],
    why: 'The writing guide\'s rule for inflated contrast matched this sentence.',
  },
  em_dashes: {
    ladder: [
      'Would a comma or a full stop read better here?',
      'This sentence uses dashes for rhythm or an aside, and the paragraph has two or more of them.',
      'Make one dash a full stop and the other a comma, or give the aside a sentence of its own.',
    ],
    why: 'The paragraph has two or more em dashes or spaced dashes, the writing guide\'s sign of dashes used for rhythm.',
  },
  stock_formula: {
    ladder: [
      'Is this a phrase you would say out loud?',
      '"Not only X but also Y" is a stock formula; it makes two plain points sound like a flourish.',
      'Name both points plainly in one sentence, or drop the weaker one.',
    ],
    why: 'The writing guide\'s rule for stock formulas matched this sentence.',
  },
  colon_title: {
    ladder: [
      'Could the title be one plain phrase?',
      'The title is written as "Label: explanation", which the writing guide asks you to avoid.',
      'Keep whichever half says what the essay argues, or turn the title into the question it answers.',
    ],
    why: 'The writing guide\'s rule for colon titles matched the title.',
  },
};

/** The sentences of a paragraph, as ranges of the draft. */
function sentences(paragraph: Paragraph): Paragraph[] {
  const out: Paragraph[] = [];
  const pattern = /[^.!?]+(?:[.!?]+["'”’)]*|$)/g;
  for (let m = pattern.exec(paragraph.text); m && m[0]; m = pattern.exec(paragraph.text)) {
    const lead = m[0].match(/^\s*/)![0].length;
    const text = m[0].trim();
    if (text) out.push({ from: paragraph.from + m.index + lead, to: paragraph.from + m.index + lead + text.length, text });
  }
  return out;
}

/**
 * The writing guide check, run locally: lib/writing/check.ts's rules on each
 * sentence, and on the title. A rule that needs the paragraph (two dashes)
 * is anchored to the first sentence with a dash in it. One finding per
 * pattern per paragraph, opening as a marker.
 */
export function writingGuideFindings(doc: string): Finding[] {
  const out: Finding[] = [];
  const add = (pattern: WritingPattern, range: { from: number; to: number }) => {
    const ladder = GUIDE_LADDERS[pattern];
    if (!ladder) return;
    out.push({ anchor: makeAnchor(doc, range.from, range.to), ladder: ladder.ladder, why: ladder.why, rung: 0 });
  };
  const title = doc.match(/^#\s+(.+)$/m);
  if (title && title.index !== undefined) {
    const text = title[1].trim();
    if (WRITING_PATTERNS.colon_title.rule?.({ title: text })) {
      const from = title.index + title[0].indexOf(text);
      add('colon_title', { from, to: from + text.length });
    }
  }
  for (const paragraph of essayParagraphs(doc).slice(0, PARAGRAPHS_MAX)) {
    const raised = new Set<WritingPattern>();
    const parts = sentences(paragraph);
    for (const sentence of parts) {
      for (const score of ruleScores({ body: sentence.text })) {
        if (score.score < 1 || raised.has(score.pattern) || score.pattern === 'em_dashes') continue;
        raised.add(score.pattern);
        add(score.pattern, sentence);
      }
    }
    const dashes = ruleScores({ body: paragraph.text }).find((s) => s.pattern === 'em_dashes');
    if (dashes && dashes.score >= 1) {
      const sentence = parts.find((s) => /—|\s–\s|\s--\s/.test(s.text)) ?? parts[0] ?? paragraph;
      add('em_dashes', sentence);
    }
  }
  return out;
}

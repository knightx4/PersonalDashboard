/**
 * What a Learn kind typed into capture says (plan #1950.4), read without a
 * model: the topic and the reading list pasted under it, and the notes and
 * material a quiz is over. Pure, so it is tested without a session.
 */

import { heuristicParseReferences } from '@/lib/learn/import/parse-heuristic';
import { MAX_QUIZ_NOTES } from '@/lib/learn/quiz/model';

/** A topic's name is a name; the detail belongs on its page. */
export const TOPIC_TITLE_MAX = 300;
/** As many readings as an import takes from one paste. */
export const TOPIC_READINGS_MAX = 40;

export type TopicFromText = {
  title: string;
  readings: { title: string; why: string | null }[];
};

/**
 * The first line names the topic; any lines under it are a reading list,
 * read line by line as the import's own heuristic reads a paste. Each goes
 * in as a reading with nothing looked up yet, found from its own row.
 */
export function topicFromText(text: string): TopicFromText | { error: string } {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first < 0) return { error: 'Give the topic a name.' };
  const title = lines[first]!.replace(/\s+/g, ' ').trim();
  if (title.length > TOPIC_TITLE_MAX) {
    return { error: 'That name is too long. Put the reading list on the lines below it.' };
  }
  const rest = lines.slice(first + 1).join('\n');
  const readings = heuristicParseReferences(rest)
    .slice(0, TOPIC_READINGS_MAX)
    .map((reference) => {
      // The link stays in the title, so nothing pasted is lost before the
      // row is given a source.
      const named = reference.author ? `${reference.title} by ${reference.author}` : reference.title;
      const title = reference.url && reference.url !== reference.title ? `${named} ${reference.url}` : named;
      return { title: title.slice(0, TOPIC_TITLE_MAX), why: reference.why };
    });
  return { title, readings };
}

export type QuizFromText = { paste: string; notes: string[] };

const WIKILINK = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

/**
 * The notes a quiz names as [[Note title]], and the rest as material pasted
 * in. A quiz needs one or the other.
 */
export function quizFromText(text: string): QuizFromText | { error: string } {
  const notes = [...new Set([...text.matchAll(WIKILINK)].map((match) => match[1]!.trim()).filter(Boolean))];
  if (notes.length > MAX_QUIZ_NOTES) return { error: `${MAX_QUIZ_NOTES} notes is the most one quiz is written from.` };
  const paste = text.replace(WIKILINK, ' ').trim();
  // What is left once the links are out may be only the commas between them.
  const material = /[\p{L}\p{N}]/u.test(paste) ? paste : '';
  if (!material && notes.length === 0) {
    return { error: 'Paste something to be quizzed on, or name a note as [[Note title]].' };
  }
  return { paste: material, notes };
}

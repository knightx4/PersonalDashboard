import { createHash } from 'crypto';

/**
 * Question fingerprints.
 *
 * Application forms recycle the same handful of questions with cosmetic
 * variation: "Please briefly describe why you want to work here (in your own
 * words)" and "Why do you want to work here?" are the same question wearing
 * different clothes. Normalising away the padding and hashing what is left
 * catches that class exactly and for free.
 *
 * It will NOT catch "Why do you want to work here?" versus "What draws you to
 * our mission?" -- those are the same question only semantically. Lookup runs
 * fingerprint first and falls back to similarity over questions.text, and the
 * near matches are offered as suggestions rather than auto-filled, because a
 * wrong canonical answer suggestion is more annoying than a missed one.
 */

/** Padding that carries no meaning and varies between forms. */
const FILLER = [
  'please',
  'briefly',
  'in your own words',
  'tell us',
  'describe',
  'approximately',
  'words or less',
  'characters or less',
  'max',
  'maximum',
  'optional',
  'required',
  'if applicable',
  'kindly',
  'feel free to',
];

/**
 * Grammatical glue. Stripped after the filler pass because the padded and
 * unpadded forms of one question rarely agree on it: "why DO YOU want to work
 * here" and "why you want to work here" are the same question, and the second
 * is what is left after "please briefly describe" is removed from the first.
 * Without this pass the normalisation produces two different fingerprints for
 * the single most common question on earth.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'about', 'be', 'can', 'could', 'did', 'do', 'does',
  'for', 'have', 'has', 'in', 'is', 'it', 'me', 'of', 'on', 'our', 'that',
  'the', 'this', 'to', 'us', 'we', 'will', 'would', 'you', 'your', 'yours',
]);

export function normalizeQuestion(text: string): string {
  let out = text.toLowerCase();

  // Word/character limits are formatting, not content.
  out = out.replace(/\(?\s*\d+\s*(words?|characters?)\s*(or less|max(imum)?)?\s*\)?/g, ' ');

  for (const phrase of FILLER) {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  }

  out = out
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return out
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word))
    .join(' ');
}

export function questionFingerprint(text: string): string {
  return createHash('sha1').update(normalizeQuestion(text)).digest('hex');
}

/**
 * Split a pasted block into individual questions.
 *
 * Accepts one per line, numbered lists, and bulleted lists, because those are
 * the three shapes a human actually pastes. A blank-line-separated block is
 * treated as one question so multi-line prompts survive intact.
 */
export function splitQuestionBlock(block: string): string[] {
  const normalized = block.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const numbered = lines.filter((line) => /^\s*(\d+[.)]|[-*•])\s+/.test(line));

  // A numbered or bulleted list: each marker starts a question, and unmarked
  // lines belong to the question above them.
  if (numbered.length >= 2) {
    const out: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\s*(\d+[.)]|[-*•])\s+/.test(line)) {
        out.push(trimmed.replace(/^\s*(\d+[.)]|[-*•])\s+/, '').trim());
      } else if (out.length > 0) {
        out[out.length - 1] = `${out[out.length - 1]} ${trimmed}`.trim();
      } else {
        out.push(trimmed);
      }
    }
    return out.filter(Boolean);
  }

  // Otherwise: blank lines separate questions, single newlines wrap.
  return normalized
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split('\n').map((l) => l.trim()).join(' ').trim())
    .filter(Boolean);
}

/**
 * Fields every application form has and nobody wants in their question bank.
 * Filtering these is what makes the bookmarklet's output usable rather than a
 * list of forty inputs including "Country code".
 */
const NON_QUESTION = [
  /^(first|last|full|preferred|legal)\s*name\b/i,
  /^name$/i,
  /^e-?mail\b/i,
  /^phone\b/i,
  /^(mobile|telephone)\b/i,
  /^address\b/i,
  /^city\b/i,
  /^state\b/i,
  /^(zip|postal)\b/i,
  /^country\b/i,
  /^resume|^cv\b/i,
  /^cover letter$/i,
  /^linkedin\b/i,
  /^github\b/i,
  /^portfolio\b/i,
  /^website\b/i,
  /\bupload\b/i,
  /\battach\b/i,
  // EEO / self-identification blocks. Legally mandated, never worth drafting.
  /\b(gender|race|ethnicity|veteran|disability|hispanic|latino)\b/i,
  /self.?identif/i,
  /\bpronouns?\b/i,
  /\bdate of birth\b/i,
  /\bhow did you hear about\b/i,
];

export function looksLikeQuestion(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length < 8) return false;
  if (trimmed.length > 600) return false;
  return !NON_QUESTION.some((pattern) => pattern.test(trimmed));
}

export type QuestionKind =
  | 'motivation'
  | 'fit'
  | 'behavioral'
  | 'technical'
  | 'logistics'
  | 'demographic'
  | 'other';

/**
 * A cheap kind guess, so a freshly captured form is sorted rather than a flat
 * list. Wrong guesses cost a dropdown change; no guess costs every question
 * being filed as "other" forever.
 */
export function guessQuestionKind(text: string): QuestionKind {
  const t = text.toLowerCase();
  if (/\b(gender|race|ethnicity|veteran|disability|sponsor|authoriz|visa|work permit)\b/.test(t)) {
    return /\b(sponsor|authoriz|visa|work permit)\b/.test(t) ? 'logistics' : 'demographic';
  }
  if (/\b(salary|compensation|notice period|start date|relocat|available|location|remote)\b/.test(t)) {
    return 'logistics';
  }
  if (/\b(why (do|are) you|what (draws|excites|interests)|interested in|our mission|this role|this company)\b/.test(t)) {
    return 'motivation';
  }
  if (/\b(tell me about a time|describe a (time|situation)|give an example|a time when)\b/.test(t)) {
    return 'behavioral';
  }
  if (/\b(experience with|proficien|which tools|stack|sql|python|excel|model|technical)\b/.test(t)) {
    return 'technical';
  }
  if (/\b(what makes you|why are you a|good fit|qualif|strength)\b/.test(t)) {
    return 'fit';
  }
  return 'other';
}

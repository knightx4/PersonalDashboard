/**
 * Which evidence items go into the match call.
 *
 * The cheap half of the match, and the same instinct as
 * lib/jobs/jd/requirements.ts: a heuristic gets most of the value at zero cost
 * and zero latency, and the model refines what it finds.
 *
 * At the size of one person's bank this usually returns most of the bank,
 * which is fine — the shortlist exists so the call stays bounded as the bank
 * grows, not because twenty-five items are too many to send. It is also what
 * stops one prolific item from crowding out the rest: the union is taken per
 * requirement, so an item that is the best answer to a line nothing else
 * touches survives even if it scores badly overall.
 */
import type { Requirement } from '../jd/requirements';

export interface ShortlistItem {
  id: string;
  title: string;
  body: string;
  context: string | null;
  metrics: string | null;
  skills: string[];
  strength: number;
}

/** Per requirement. Small: the union across a JD's lines is what matters. */
const PER_REQUIREMENT = 4;

/** However much the union comes to, the call sends at most this many. */
export const MAX_SHORTLIST = 40;

/**
 * Words that appear in every job description and every story, so matching on
 * them is matching on nothing. Kept short on purpose — an aggressive stoplist
 * throws away the domain words that actually carry the signal.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'for', 'from', 'had',
  'has', 'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'that', 'the', 'their',
  'them', 'they', 'this', 'to', 'up', 'was', 'we', 'were', 'will', 'with', 'you', 'your',
  'ability', 'experience', 'strong', 'excellent', 'work', 'working', 'role', 'team', 'teams',
  'years', 'year', 'plus', 'other', 'across', 'within', 'including', 'well', 'able', 'must',
]);

/**
 * Crude singularisation, so "stakeholders" matches "stakeholder". Full
 * stemming is not worth a dependency here: the model does the real reading and
 * this only has to decide what it gets to read.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  return word;
}

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    const word = stem(raw);
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

/**
 * How well one item answers one requirement.
 *
 * The title is weighted above the body because a handle is chosen to say what
 * the story is about, while a body repeats ordinary narrative words. Skills
 * count for more than either: a tag is a deliberate claim about what the story
 * demonstrates, which is exactly the question a requirement asks. Strength is
 * a tiebreak only — a strong story about the wrong thing is still the wrong
 * story, and letting it outrank a weaker relevant one is how the shortlist
 * ends up returning your greatest hits for every role.
 */
export function scoreItem(requirement: string, item: ShortlistItem): number {
  const wanted = tokenize(requirement);
  if (wanted.size === 0) return 0;

  const title = tokenize(item.title);
  const body = tokenize(`${item.body} ${item.context ?? ''} ${item.metrics ?? ''}`);
  const skills = tokenize(item.skills.join(' '));

  let score = 0;
  for (const word of wanted) {
    if (skills.has(word)) score += 3;
    else if (title.has(word)) score += 2;
    else if (body.has(word)) score += 1;
  }

  // Normalised by the requirement's length, so a fifteen-word line does not
  // outscore a five-word one purely by having more chances to hit.
  return score / wanted.size + item.strength / 100;
}

/**
 * The union of the best items per requirement, most broadly useful first.
 *
 * Ordering matters at the cap: when the union overflows, what survives should
 * be the items that answer the most lines, not the ones that happen to sit
 * near the top of the description.
 */
export function shortlistEvidence(
  requirements: readonly Requirement[],
  bank: readonly ShortlistItem[],
): ShortlistItem[] {
  if (bank.length === 0 || requirements.length === 0) return [];

  const reach = new Map<string, number>();

  for (const requirement of requirements) {
    const ranked = bank
      .map((item) => ({ item, score: scoreItem(requirement.text, item) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_REQUIREMENT);

    for (const entry of ranked) {
      reach.set(entry.item.id, (reach.get(entry.item.id) ?? 0) + entry.score);
    }
  }

  // A bank nothing lexically matches is not a bank with nothing to say — the
  // JD may simply use different words. Falling back to the strongest items
  // hands the model something to judge rather than an empty set, which is an
  // error further down.
  if (reach.size === 0) {
    return [...bank].sort((a, b) => b.strength - a.strength).slice(0, PER_REQUIREMENT * 2);
  }

  const byId = new Map(bank.map((item) => [item.id, item]));
  return [...reach.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SHORTLIST)
    .map(([id]) => byId.get(id))
    .filter((item): item is ShortlistItem => item !== undefined);
}

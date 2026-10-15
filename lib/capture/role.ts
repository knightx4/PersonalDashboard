/**
 * What a role typed into capture names (plan #1950.4): a posting link, or the
 * role and the company in a sentence. A link is read for the rest by the
 * writer, as Dash's add_job_lead reads one; a sentence is split here, so
 * "Strategic Finance Analyst at Ramp" makes a role without a model call.
 */

export type RoleFromText = {
  url: string | null;
  title: string;
  company: string;
};

const LINK = /https?:\/\/[^\s<>"']+/i;

/** Words that join a role to its company, tried from the last one in the sentence. */
const JOINS = [/\s+at\s+/i, /\s+@\s*/, /\s+with\s+/i, /\s+[-–—|]\s+/, /,\s+/];

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '');
}

/** The role and company a sentence names, split at the last join; null when it names one without the other. */
function split(sentence: string): { title: string; company: string } | null {
  for (const join of JOINS) {
    const global = new RegExp(join.source, `${join.flags.replace('g', '')}g`);
    let last: RegExpExecArray | null = null;
    for (let match = global.exec(sentence); match; match = global.exec(sentence)) last = match;
    if (!last) continue;
    const title = tidy(sentence.slice(0, last.index));
    const company = tidy(sentence.slice(last.index + last[0].length));
    if (title && company) return { title, company };
  }
  return null;
}

/**
 * The link, title and company in what was typed. With a link, the words
 * around it fill the title and company only when they name both; the page
 * fills the rest. Without one, the sentence has to name both, and the
 * sentence saying how to write it comes back otherwise.
 */
export function roleFromText(text: string): RoleFromText | { error: string } {
  const flat = text.replace(/\s+/g, ' ').trim();
  const link = flat.match(LINK);
  if (link) {
    const url = link[0].replace(/[).,;]+$/, '');
    const rest = tidy(flat.replace(link[0], ' '));
    const named = rest ? split(rest) : null;
    return { url, title: named?.title ?? '', company: named?.company ?? '' };
  }
  const named = split(flat);
  if (!named) {
    return { error: 'Paste the posting link, or write the role at the company, such as Strategic Finance Analyst at Ramp.' };
  }
  return { url: null, ...named };
}

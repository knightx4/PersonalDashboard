/**
 * Evidence on one point of an essay (docs/LEARN-ESSAYS-SPEC.md, "Evidence on
 * a point").
 *
 * The person presses one of four buttons on a point in Develop: the rule
 * that applies, evidence for it, the strongest objection, or a real case.
 * One Sonnet call searches the web for that one thing and returns up to three
 * items, each built from a search result so it carries the API's citation.
 *
 * Why it works this way, from the evaluation on 15 October 2026:
 * - Practitioner essays of this length for a CFO-office reader cite one to
 *   three sources, mostly the rules the reader answers to, named by
 *   identifier and used as warrants; the author's own experience carries the
 *   rest. So the search is narrow and per point, and "the rule" leads.
 * - Research filed by the point it supports is what a writer needs at the
 *   moment of writing that paragraph, which a report on the whole question
 *   is not.
 * - The two whole-question runs on the test essay cited four vendor blogs and
 *   two write-ups of a standard, never the standard itself, and neither
 *   noticed that SR 11-7 had been rescinded. So the call is told to cite the
 *   primary document, label who published each source, and say when guidance
 *   has been superseded.
 *
 * Nothing here touches the database or the network.
 */

import { addCitation, isWebUrl, SourceList, type ResearchCitation } from './research';
import { splitItem } from './research-map';
import { SOURCE_TYPES, type EvidenceKind, type PointEvidence, type SourceType } from './plan';

/** Searches one press may make. */
export const EVIDENCE_SEARCHES = 4;
/** Items one press returns. */
export const EVIDENCE_ITEMS = 3;

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  rule: 'The rule that applies',
  for: 'Evidence for it',
  against: 'The strongest objection',
  case: 'A real case',
};

/** What each kind asks the search for. */
const WANTS: Record<EvidenceKind, string> = {
  rule: 'the standard, regulation, framework or supervisory guidance that governs this point for the reader, named by its identifier and section (for example a COSO principle, a PCAOB standard, an SEC rule), and what it requires or expects',
  for: 'specific evidence that this point is true: a finding, a figure, a documented practice, or a standard that requires it',
  against:
    'the strongest case against this point, as a serious person who disagrees would make it, with who makes it; not a weak or fringe objection',
  case: 'a real, documented case or example where this point played out, such as an incident, an enforcement action, a published company practice or a study of practice',
};

export const EVIDENCE_SYSTEM = `You are Dash, finding evidence for one point of a short essay that someone is
writing themselves. You do not write any of their essay. They know their
field, so never explain its basics.

Search the web, at most ${EVIDENCE_SEARCHES} times, in general terms about the subject; never
paste their words into a search. Cite the primary document itself (the
standard, the regulation, the study) rather than an article about it whenever
the search finds it. Check that any guidance you cite is still in force; if it
has been rescinded, superseded or deferred, say so in the item. Prefer
regulators, standard-setters, research and professional bodies; use a vendor
only when nothing better says the same, and label it.

Reply with up to ${EVIDENCE_ITEMS} items and nothing else, each on its own line in exactly
this form:
- [TYPE] **Headline of under twelve words**: one or two sentences giving the specific thing and who says it.

TYPE is one of: ${SOURCE_TYPES.join(', ')}.
Every item must rest on a search result so it carries a citation; leave out
anything you cannot source. If you find nothing good, reply with the single
word: None.`;

export function evidencePrompt(input: {
  question: string;
  thesis: string;
  reader: string;
  point: string;
  kind: EvidenceKind;
}): string {
  return [
    `The essay's question: ${input.question.trim() || '(not written)'}`,
    `Their answer: ${input.thesis.trim() || '(not written yet)'}`,
    `Reader: ${input.reader.trim() || 'a general reader'}`,
    '',
    `The point: ${input.point.trim()}`,
    '',
    `Find: ${WANTS[input.kind]}.`,
  ].join('\n');
}

type Block = Record<string, unknown>;

function blocks(content: unknown): Block[] {
  return Array.isArray(content)
    ? content.filter((b): b is Block => typeof b === 'object' && b !== null)
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readType(label: string): SourceType | null {
  const word = label.trim().toLowerCase();
  if ((SOURCE_TYPES as readonly string[]).includes(word)) return word as SourceType;
  if (/standard/.test(word)) return 'standard-setter';
  if (/regulat|government|supervis|law/.test(word)) return 'regulator';
  if (/research|academic|journal|study/.test(word)) return 'research';
  if (/professional|institute|association/.test(word)) return 'professional body';
  if (/vendor|software|company blog/.test(word)) return 'vendor';
  if (/firm|consult|big four|audit/.test(word)) return 'firm';
  if (/press|media|news/.test(word)) return 'press';
  return null;
}

/** Addresses whose publisher is plain from the domain alone, which overrules the model's label. */
export function typeFromDomain(domain: string): SourceType | null {
  if (
    /(^|\.)(gov|mil)(\.[a-z]{2})?$|(^|\.)(europa\.eu|federalreserve\.gov|sec\.gov|pcaobus\.org|fdic\.gov|occ\.gov|eba\.europa\.eu|bis\.org|fca\.org\.uk)$/.test(
      domain,
    )
  ) {
    return 'regulator';
  }
  if (/(^|\.)(coso\.org|nist\.gov|iso\.org|fasb\.org|ifrs\.org|aicpa-cima\.com)$/.test(domain))
    return 'standard-setter';
  if (/(^|\.)(theiia\.org|isaca\.org|imanet\.org|thecaq\.org|accaglobal\.com)$/.test(domain))
    return 'professional body';
  if (
    /(^|\.)(doi\.org|springer\.com|sciencedirect\.com|nih\.gov|ssrn\.com|arxiv\.org|jstor\.org|sagepub\.com|wiley\.com)$/.test(
      domain,
    )
  ) {
    return 'research';
  }
  if (
    /(^|\.)(deloitte\.com|pwc\.com|ey\.com|kpmg\.com|kpmg\.us|mckinsey\.com|bcg\.com)$/.test(domain)
  )
    return 'firm';
  return null;
}

/**
 * The items from the reply: each line starting "- " is an item, its
 * "[TYPE]" label read and checked against the address, and the web search
 * citations on its text give the quote and the page. An item with no
 * citation is dropped.
 */
export function readEvidence(content: unknown, kind: EvidenceKind): Omit<PointEvidence, 'id'>[] {
  const list = new SourceList();
  type Open = { text: string; citations: ResearchCitation[] };
  const items: Open[] = [];
  let current: Open | null = null;
  let atLineStart = true;

  for (const block of blocks(content)) {
    if (block.type !== 'text') continue;
    const text = str(block.text);
    text.split('\n').forEach((line, i) => {
      const startsLine = i > 0 || atLineStart;
      const item = startsLine ? /^\s*[-*]\s+(.*)$/.exec(line) : null;
      if (item) {
        current = { text: item[1]!, citations: [] };
        items.push(current);
        return;
      }
      if (startsLine && line.trim() === '') return;
      if (current) current.text += (i > 0 ? ' ' : '') + line;
    });
    atLineStart = text.endsWith('\n');
    const target = current as Open | null;
    if (!target) continue;
    for (const raw of blocks(block.citations)) {
      if (raw.type !== 'web_search_result_location') continue;
      const url = str(raw.url);
      if (!isWebUrl(url)) continue;
      addCitation(target.citations, {
        source: list.add(url, str(raw.title)),
        quote: str(raw.cited_text),
      });
    }
  }

  const out: Omit<PointEvidence, 'id'>[] = [];
  for (const item of items) {
    const first = item.citations[0];
    if (!first) continue;
    const source = list.sources[first.source]!;
    const label = /^\s*\[([^\]]+)\]\s*/.exec(item.text);
    const rest = label ? item.text.slice(label[0].length) : item.text;
    const { title, summary } = splitItem(rest);
    if (!title && !summary) continue;
    out.push({
      kind,
      sourceType: typeFromDomain(source.domain) ?? (label ? readType(label[1]!) : null) ?? 'press',
      title,
      summary,
      quote: first.quote,
      url: source.url,
      sourceTitle: source.title,
      domain: source.domain,
      take: '',
    });
    if (out.length === EVIDENCE_ITEMS) break;
  }
  return out;
}

/**
 * A response with the encrypted search payloads taken out, as it is logged
 * and replayed: the parsers never read them, and they are most of its size.
 */
export function loggableContent(content: unknown): unknown[] {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'encrypted_content' || key === 'encrypted_index' || key === 'signature') continue;
      out[key] = strip(v);
    }
    return out;
  };
  return Array.isArray(content) ? (strip(content) as unknown[]) : [];
}

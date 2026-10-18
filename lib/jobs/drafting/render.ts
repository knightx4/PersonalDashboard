/**
 * Gathered material as prompt text (plan #2130.2).
 *
 * renderMaterial is everything the drafts draw on, in a fixed order so the
 * same application renders the same prefix and caches; renderQuestions is
 * what is to be answered, kept apart so a caller can put it last or leave it
 * out (a cover letter answers no question). The per-item renderers are what
 * gather() measures each item by when it cuts a list to budget, so the
 * budgets hold for the text that is actually sent.
 */
import { describeLimit } from './limits';
import type {
  GatheredEvidence,
  GatheredMaterial,
  GatheredQuestion,
  GatheredRequirement,
  GatheredThought,
  PastAnswer,
  VaultPassage,
} from './types';

function lines(parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join('\n');
}

export function renderEvidenceItem(item: GatheredEvidence): string {
  return lines([
    `id: ${item.id}`,
    `title: ${item.title}`,
    item.context && `where: ${item.context}`,
    item.metrics && `result: ${item.metrics}`,
    item.skills.length > 0 && `tags: ${item.skills.join(', ')}`,
    `story: ${item.body}`,
  ]);
}

export function renderRequirement(requirement: GatheredRequirement): string {
  const kind = requirement.kind.replace(/_/g, ' ');
  const verdict = requirement.verdict
    ? ` [${requirement.verdict}${requirement.evidenceItemId ? `, evidence ${requirement.evidenceItemId}` : ''}${requirement.why ? `: ${requirement.why}` : ''}]`
    : '';
  return `- (${kind}) ${requirement.text}${verdict}`;
}

export function renderPastAnswer(past: PastAnswer): string {
  const label = past.status === 'default' ? 'default answer' : past.status;
  return `Q: ${past.question}\nA (${label}): ${past.answer}`;
}

export function renderThought(thought: GatheredThought): string {
  return `- ${thought.at ? `${thought.at.slice(0, 10)}: ` : ''}${thought.body}`;
}

export function renderVaultPassage(passage: VaultPassage): string {
  return lines([passage.title && `From "${passage.title}":`, passage.text]);
}

export function renderQuestion(question: GatheredQuestion): string {
  return lines([
    `answer id: ${question.answerId}`,
    `question: ${question.text}`,
    question.kind && `kind: ${question.kind}`,
    question.limit && `limit: ${describeLimit(question.limit)}`,
    question.answer
      ? `current answer (${question.status ?? 'draft'}): ${question.answer}`
      : 'current answer: none',
    question.defaultAnswer && `their default answer to this question: ${question.defaultAnswer}`,
  ]);
}

function omittedLine(omitted: number, what: string): string | null {
  return omitted > 0 ? `(${omitted} more ${what} left out for length.)` : null;
}

function section(heading: string, body: string | null): string | null {
  return body ? `## ${heading}\n\n${body}` : null;
}

/** Everything the drafts draw on, without the questions. */
export function renderMaterial(material: GatheredMaterial): string {
  const { role } = material;
  const roleLabel = [role.title, role.company && `at ${role.company}`].filter(Boolean).join(' ');

  return [
    section(
      'The role',
      lines([
        `Role: ${roleLabel}`,
        role.industry && `Industry: ${role.industry}`,
        role.requirements.length > 0 &&
          `What it asks for:\n${role.requirements.map(renderRequirement).join('\n')}`,
        role.posting && `The posting:\n${role.posting}`,
      ]),
    ),
    section(
      'What they have found out about the company',
      lines([role.research, ...role.notes.map((note) => `- ${note}`)]) || null,
    ),
    section('Their own view of the company, in their words', role.perspective),
    section('Research prepared on the company', role.researchWriteUp),
    section(
      'Their evidence bank',
      material.evidence.items.length > 0
        ? lines([
            material.evidence.items.map(renderEvidenceItem).join('\n\n---\n\n'),
            omittedLine(material.evidence.omitted, 'items'),
          ])
        : 'The evidence bank is empty.',
    ),
    section(
      'Their résumé',
      material.resume
        ? lines([material.resume.label && `(${material.resume.label})`, material.resume.text])
        : null,
    ),
    section(
      'Answers they have approved or sent before',
      material.pastAnswers.items.length > 0
        ? lines([
            material.pastAnswers.items.map(renderPastAnswer).join('\n\n'),
            omittedLine(material.pastAnswers.omitted, 'answers'),
          ])
        : null,
    ),
    section(
      'What they have been thinking about the search',
      material.thoughts.items.length > 0
        ? lines([material.thoughts.items.map(renderThought).join('\n'), omittedLine(material.thoughts.omitted, 'entries')])
        : null,
    ),
    section(
      'From their notes',
      material.vault.passages.length > 0
        ? material.vault.passages.map(renderVaultPassage).join('\n\n')
        : null,
    ),
    section(
      'How they write',
      lines([
        material.style.notes,
        material.style.banned.length > 0 &&
          `Never use: ${material.style.banned.map((b) => `"${b}"`).join(', ')}`,
      ]) || null,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The application's questions, each with its answer id, limit and current answer. */
export function renderQuestions(questions: readonly GatheredQuestion[]): string {
  return section('The questions on this application', questions.map(renderQuestion).join('\n\n---\n\n')) ?? '';
}

/** The material and the questions together, as one block. */
export function renderGathered(material: GatheredMaterial): string {
  return [renderMaterial(material), material.questions.length > 0 ? renderQuestions(material.questions) : null]
    .filter(Boolean)
    .join('\n\n');
}

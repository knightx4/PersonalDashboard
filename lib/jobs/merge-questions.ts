import { questionFingerprint } from './fingerprint';

/**
 * Planning for the one-off merge of questions stored twice (plan #2195.2).
 *
 * A change to normalizeQuestion leaves old fingerprints behind, so two rows
 * that now normalise to the same text sit side by side: "1. Why do you want
 * to work here?" and "Why do you want to work here?". This module takes the
 * rows as they are and returns what to change, with no database access, so
 * the same plan can be printed, tested, run in a transaction by
 * scripts/merge-questions.ts, or turned into SQL for a session with no
 * database URL.
 */

export interface QuestionRow {
  id: string;
  user_id: string;
  text: string;
  fingerprint: string;
  canonical_answer: string | null;
  canonical_answer_updated_at: string | null;
  times_seen: number;
  created_at: string;
}

export interface AnswerRow {
  id: string;
  application_id: string;
  question_id: string;
  answer: string | null;
  generated_from_question_id: string | null;
  created_at: string;
}

export interface MergeGroup {
  userId: string;
  fingerprint: string;
  keep: QuestionRow;
  drop: QuestionRow[];
  timesSeen: number;
  /** Set when the kept row has no canonical answer and a dropped one does. */
  canonical: { answer: string; updatedAt: string | null } | null;
  /** Answer rows deleted because the application answered the question twice. */
  deleteAnswerIds: string[];
  /** Answer rows moved onto the kept question. */
  repointAnswerIds: string[];
  /** Answer rows whose generated_from_question_id moves to the kept question. */
  repointGeneratedFromIds: string[];
}

export interface FingerprintUpdate {
  id: string;
  from: string;
  to: string;
}

export interface MergePlan {
  groups: MergeGroup[];
  /** Every surviving row whose stored fingerprint differs from the current one. */
  fingerprintUpdates: FingerprintUpdate[];
}

const hasContent = (s: string | null) => !!s && s.trim() !== '';

function byAge<T extends { created_at: string; id: string }>(a: T, b: T) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
}

export function planQuestionMerges(
  questions: QuestionRow[],
  answers: AnswerRow[],
  fingerprint: (text: string) => string = questionFingerprint,
): MergePlan {
  const byKey = new Map<string, QuestionRow[]>();
  const next = new Map<string, string>();
  for (const q of questions) {
    const fp = fingerprint(q.text);
    next.set(q.id, fp);
    const key = `${q.user_id}\u0000${fp}`;
    byKey.set(key, [...(byKey.get(key) ?? []), q]);
  }

  const groups: MergeGroup[] = [];
  const dropped = new Set<string>();
  for (const rows of byKey.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort(byAge);
    const [keep, ...drop] = sorted;
    const ids = new Set(sorted.map((r) => r.id));
    drop.forEach((d) => dropped.add(d.id));

    const donor = sorted.find((r) => r.id !== keep.id && hasContent(r.canonical_answer));
    const canonical =
      !hasContent(keep.canonical_answer) && donor
        ? { answer: donor.canonical_answer as string, updatedAt: donor.canonical_answer_updated_at }
        : null;

    const deleteAnswerIds: string[] = [];
    const repointAnswerIds: string[] = [];
    const perApp = new Map<string, AnswerRow[]>();
    for (const a of answers) {
      if (ids.has(a.question_id)) perApp.set(a.application_id, [...(perApp.get(a.application_id) ?? []), a]);
    }
    for (const list of perApp.values()) {
      const ordered = [...list].sort((a, b) =>
        a.question_id === keep.id ? -1 : b.question_id === keep.id ? 1 : byAge(a, b),
      );
      // The kept question's answer wins unless it is empty and another has content.
      const winner = ordered.find((a) => hasContent(a.answer)) ?? ordered[0];
      for (const a of ordered) if (a !== winner) deleteAnswerIds.push(a.id);
      if (winner.question_id !== keep.id) repointAnswerIds.push(winner.id);
    }

    const repointGeneratedFromIds = answers
      .filter(
        (a) =>
          a.generated_from_question_id &&
          ids.has(a.generated_from_question_id) &&
          a.generated_from_question_id !== keep.id &&
          !deleteAnswerIds.includes(a.id),
      )
      .map((a) => a.id);

    groups.push({
      userId: keep.user_id,
      fingerprint: next.get(keep.id) as string,
      keep,
      drop,
      timesSeen: sorted.reduce((n, r) => n + r.times_seen, 0),
      canonical,
      deleteAnswerIds,
      repointAnswerIds,
      repointGeneratedFromIds,
    });
  }

  const fingerprintUpdates: FingerprintUpdate[] = questions
    .filter((q) => !dropped.has(q.id) && next.get(q.id) !== q.fingerprint)
    .map((q) => ({ id: q.id, from: q.fingerprint, to: next.get(q.id) as string }));

  return { groups, fingerprintUpdates };
}

const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const idList = (ids: string[]) => ids.map((i) => lit(i)).join(', ');

/**
 * The plan as ordered statements, for a transaction. Answers move before the
 * extra questions go, because deleting a question cascades to its answers.
 * Fingerprints change in two passes so that no row briefly holds the value
 * another row is about to take, which the unique index on (user_id,
 * fingerprint) would refuse.
 */
export function planStatements(plan: MergePlan): string[] {
  const out: string[] = [];
  for (const g of plan.groups) {
    const keep = lit(g.keep.id);
    const dropIds = idList(g.drop.map((d) => d.id));
    if (g.deleteAnswerIds.length)
      out.push(`delete from job_search.application_answers where id in (${idList(g.deleteAnswerIds)})`);
    if (g.repointAnswerIds.length)
      out.push(
        `update job_search.application_answers set question_id = ${keep} where id in (${idList(g.repointAnswerIds)})`,
      );
    if (g.repointGeneratedFromIds.length)
      out.push(
        `update job_search.application_answers set generated_from_question_id = ${keep} where id in (${idList(g.repointGeneratedFromIds)})`,
      );
    const sets = [`times_seen = ${g.timesSeen}`];
    if (g.canonical) {
      sets.push(`canonical_answer = ${lit(g.canonical.answer)}`);
      sets.push(`canonical_answer_updated_at = ${lit(g.canonical.updatedAt)}`);
    }
    out.push(`update job_search.questions set ${sets.join(', ')} where id = ${keep}`);
    out.push(`delete from job_search.questions where id in (${dropIds})`);
  }
  if (plan.fingerprintUpdates.length) {
    out.push(
      `update job_search.questions set fingerprint = 'merge:' || id where id in (${idList(plan.fingerprintUpdates.map((u) => u.id))})`,
    );
    for (const u of plan.fingerprintUpdates)
      out.push(`update job_search.questions set fingerprint = ${lit(u.to)} where id = ${lit(u.id)}`);
  }
  return out;
}

export function describePlan(plan: MergePlan): string {
  const lines: string[] = [];
  for (const g of plan.groups) {
    lines.push(`group ${g.fingerprint} (user ${g.userId}), times_seen -> ${g.timesSeen}`);
    lines.push(`  keep ${g.keep.id} ${JSON.stringify(g.keep.text)}`);
    for (const d of g.drop) lines.push(`  drop ${d.id} ${JSON.stringify(d.text)}`);
    if (g.canonical) lines.push('  canonical answer taken from a dropped row');
    lines.push(
      `  answers: ${g.repointAnswerIds.length} moved, ${g.deleteAnswerIds.length} deleted as duplicates, ${g.repointGeneratedFromIds.length} generated_from moved`,
    );
  }
  lines.push(`${plan.groups.length} groups, ${plan.fingerprintUpdates.length} fingerprints to update`);
  return lines.join('\n');
}

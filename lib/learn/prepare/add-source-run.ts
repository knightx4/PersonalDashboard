import 'server-only';

import type postgres from 'postgres';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { embedCatalogueSegments, vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { licenceLabel } from '@/lib/learn/catalogue/licence-label';
import type { StructureDocumentInput } from '@/lib/learn/catalogue/structure';
import { storeStructure } from '@/lib/learn/catalogue/structure-store';
import { liveGoalPullPorts, runProvider, wiredProviders } from '@/lib/learn/catalogue/structure-pull-for-goal';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
import { isGoalKind, providersForKind } from '@/lib/learn/goal-kind';
import { storedUnitQueries } from '@/lib/learn/levels/stored-sources-run';
import { parseArxivId, fetchArxivStructure } from '@/lib/learn/providers/arxiv';
import { explainerHostFor, pullExplainer } from '@/lib/learn/providers/explainers';
import { fetchDocument } from '@/lib/learn/providers/fetch';
import { fetchOcwCourseStructure } from '@/lib/learn/providers/ocw-structure';
import { fetchOpenstaxStructure, parseOpenstaxSlug } from '@/lib/learn/providers/openstax';
import { practicalSourceFor, pullPractical } from '@/lib/learn/providers/practical';
import { pullYaleCourse, yaleCourseUrl } from '@/lib/learn/providers/yale';
import type { SourceDocument } from './finish-step';
import { addedLine, ocwCourseUrl, readSourceAsk, readerFor, webDocument } from './add-source';
import { MATCHED_WEEKS_KEPT, withAddedWeeks, type MatchedWeek } from './structure-steps';

/**
 * Add a source, with its network and database (plan #2307.4). The pure part,
 * and why it works as it does, is add-source.ts.
 *
 * The bank is shared catalogue data, so the document is stored through the
 * service-role connection, as every pull is. The row that says it was added
 * to this subject is the person's, written as them. The match pass embeds the
 * new units and joins the document's weeks into the subject's own run when
 * its match_weeks step is done; a run that has not reached the step yet reads
 * them there itself (handlers.ts, through addedSourceWeeks).
 */

type Spend = { propose: SpendReport[]; match: SpendReport[] };

export type AddSourceResult = { ok: true; lines: string[] } | { ok: false; error: string };

type Stored = { itemId: string; title: string; licence: string; units: number; unchanged: boolean };

/** Fetch and read the document at an address, by the reader its site has. */
async function pullAddress(url: string): Promise<{ ok: true; document: StructureDocumentInput } | { ok: false; detail: string }> {
  const reader = readerFor(url, {
    yale: (u) => yaleCourseUrl(u) !== null,
    openstax: (u) => /openstax\.org\//i.test(u) && parseOpenstaxSlug(u) !== null,
    arxiv: (u) => /arxiv\.org\//i.test(u) && parseArxivId(u) !== null,
    explainer: (u) => explainerHostFor(u) !== null,
    practical: (u) => practicalSourceFor(u) !== null,
  });
  switch (reader) {
    case 'ocw': {
      const course = await fetchOcwCourseStructure(ocwCourseUrl(url)!);
      return course ? { ok: true, document: course.document } : { ok: false, detail: 'MIT OpenCourseWare has no course page with a syllabus or calendar there.' };
    }
    case 'yale':
      return await pullYaleCourse(url);
    case 'openstax':
      return await fetchOpenstaxStructure(url);
    case 'arxiv':
      return await fetchArxivStructure(url);
    case 'explainer':
      return await pullExplainer(url);
    case 'practical':
      return await pullPractical(url);
    case 'web': {
      const page = await fetchDocument(url);
      if (!page.ok) return { ok: false, detail: `The page could not be fetched (${page.reason}): ${page.detail}` };
      if (page.contentType !== 'html') return { ok: false, detail: 'Only web pages can be read from an address on a site Dash has no reader for; that one is not a page.' };
      return webDocument(page.url, page.text);
    }
  }
}

async function describe(sql: postgres.Sql, itemIds: string[]): Promise<Stored[]> {
  if (itemIds.length === 0) return [];
  const rows = await sql<{ item_id: string; title: string; licence_mode: string; units: number }[]>`
    select c.item_id, i.title, c.licence_mode,
           (select count(*)::int from learn.catalogue_segments s where s.item_id = c.item_id) as units
      from learn.catalogue_structures c
      join learn.catalogue_items i on i.id = c.item_id
     where c.item_id = any(${itemIds}::uuid[])`;
  const byId = new Map(rows.map((r) => [r.item_id, r]));
  return itemIds.flatMap((id) => {
    const r = byId.get(id);
    return r ? [{ itemId: id, title: r.title, licence: r.licence_mode, units: r.units, unchanged: false }] : [];
  });
}

/** Search the subject kind's sources with the phrase, stopping at the first that stores something. */
async function pullPhrase(input: {
  sql: postgres.Sql;
  phrase: string;
  subject: { name: string; kind: string | null };
  anthropicApiKey: string | undefined;
  spend: Spend;
}): Promise<{ ok: true; itemIds: string[] } | { ok: false; detail: string }> {
  const kind = isGoalKind(input.subject.kind) ? input.subject.kind : null;
  if (!kind) return { ok: false, detail: 'This subject has no kind yet, so Dash does not know where to search. Paste an address instead.' };
  if (!input.anthropicApiKey) return { ok: false, detail: 'Searching needs ANTHROPIC_API_KEY, which this deployment does not have. Paste an address instead.' };
  const wired = new Set(wiredProviders());
  const providers = providersForKind(kind).filter((id) => wired.has(id));
  const failed: string[] = [];
  for (const id of providers) {
    const ports = liveGoalPullPorts({
      sql: input.sql,
      goal: { name: input.phrase, about: `Part of ${input.subject.name}.` },
      anthropicApiKey: input.anthropicApiKey,
      onSpend: (r) => input.spend.propose.push(r),
    });
    const run = await runProvider(id, ports);
    if (!run) continue;
    if (!run.ok) {
      failed.push(run.detail);
      continue;
    }
    const itemIds = run.lines.flatMap((l) => (l.status === 'stored' ? [l.itemId] : []));
    if (itemIds.length > 0) return { ok: true, itemIds: [...new Set(itemIds)] };
  }
  return {
    ok: false,
    detail: `Searched ${providers.length} ${providers.length === 1 ? 'source' : 'sources'} and found no document for that.${failed.length > 0 ? ` ${failed[0].slice(0, 160)}` : ''} Try other words, or paste an address.`,
  };
}

/**
 * The weeks of these documents, each with its similarity to the subject:
 * every unit that has a vector, since the person added the document.
 */
export async function addedSourceWeeks(
  sql: postgres.Sql,
  itemIds: readonly string[],
  subject: { name: string; note: string | null },
  onSpend?: (report: SpendReport) => void,
): Promise<MatchedWeek[]> {
  if (itemIds.length === 0) return [];
  const [query] = storedUnitQueries({ name: subject.name, about: subject.note }, []);
  const embedded = await embedTexts({ texts: [query], inputType: 'query', onSpend });
  if (!embedded.ok) throw new Error(`Embedding the subject failed: ${embedded.reason}: ${embedded.detail}`);
  const rows = await sql<{ id: string; item_id: string; ordinal: number; unit_label: string | null; heading: string; similarity: number }[]>`
    select s.id, s.item_id, s.ordinal, s.unit_label, s.heading,
           1 - (s.embedding operator(extensions.<=>) ${vectorLiteral(embedded.vectors[0])}::extensions.vector) as similarity
      from learn.catalogue_segments s
     where s.item_id = any(${[...itemIds]}::uuid[]) and s.embedding is not null and s.heading is not null`;
  return rows.map((r) => ({
    segmentId: r.id,
    itemId: r.item_id,
    ordinal: r.ordinal,
    label: r.unit_label,
    heading: r.heading,
    similarity: Number(r.similarity),
  }));
}

/** The documents added to a subject, for match_weeks to keep (handlers.ts). */
export async function addedSourceItems(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<string[]> {
  const { data, error } = await learn.from('subject_sources').select('item_id').eq('user_id', userId).eq('subject_id', subjectId);
  if (error) throw new Error(`Reading the added sources failed: ${error.message}`);
  return ((data ?? []) as { item_id: string }[]).map((r) => r.item_id);
}

/** The added documents as the Sources section lists them. */
export async function loadAddedSources(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<SourceDocument[]> {
  // The catalogue is readable by every account, so the person's own client reads it.
  const { data, error } = await learn
    .from('subject_sources')
    .select(
      'item_id, catalogue_items(title, canonical_url, catalogue_providers(name), catalogue_structures(licence_mode), catalogue_segments(count))',
    )
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .order('added_at');
  if (error) throw new Error(`Reading the added sources failed: ${error.message}`);
  type One<T> = T | T[] | null;
  const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  type Row = {
    item_id: string;
    catalogue_items: One<{
      title: string;
      canonical_url: string;
      catalogue_providers: One<{ name: string }>;
      catalogue_structures: One<{ licence_mode: string }>;
      catalogue_segments: One<{ count: number }>;
    }>;
  };
  return ((data ?? []) as unknown as Row[]).flatMap((r): SourceDocument[] => {
    const item = one(r.catalogue_items);
    if (!item) return [];
    return [
      {
        itemId: r.item_id,
        title: item.title,
        provider: one(item.catalogue_providers)?.name ?? null,
        url: item.canonical_url,
        licence: one(item.catalogue_structures)?.licence_mode ?? null,
        units: one(item.catalogue_segments)?.count ?? null,
        used: false,
        added: true,
      },
    ];
  });
}

/** Embed what has no vector yet, within the time given. False when time ran out first. */
async function embedNew(sql: postgres.Sql, userId: string, deadline: number): Promise<boolean> {
  for (let pass = 0; pass < 5; pass++) {
    const swept = await embedCatalogueSegments(sql, { userId, limit: 600, deadline });
    if (swept.stopped?.reason === 'time') return false;
    if (swept.stopped) throw new Error(`Embedding the new weeks stopped: ${swept.stopped.reason}: ${swept.stopped.detail}`);
    if (swept.embedded === 0) return true;
  }
  return false;
}

/**
 * Join the documents' weeks into the subject's own run, when its match_weeks
 * step is done. False when there is no such step yet: the step reads the
 * added documents itself when it runs.
 */
async function joinMatchedWeeks(
  sql: postgres.Sql,
  userId: string,
  subject: { id: string; name: string; note: string | null },
  itemIds: string[],
  spend: Spend,
): Promise<boolean> {
  const [step] = await sql<{ id: string; detail: Record<string, unknown> | null; counts: Record<string, number> | null }[]>`
    select st.id, st.detail, st.counts
      from learn.subject_preparation_steps st
      join learn.subject_preparations p on p.id = st.preparation_id
     where p.user_id = ${userId} and st.user_id = ${userId}
       and p.subject_id = ${subject.id} and p.branch_key is null
       and st.key = 'match_weeks' and st.status = 'done'`;
  if (!step) return false;
  const detail = step.detail ?? {};
  const found = Array.isArray(detail.weeks) ? (detail.weeks as MatchedWeek[]) : [];
  const had = Array.isArray(detail.added) ? (detail.added as string[]) : [];
  const allAdded = [...new Set([...had, ...itemIds])];
  const added = await addedSourceWeeks(sql, allAdded, subject, (r) => spend.match.push(r));
  const weeks = withAddedWeeks(found, added, MATCHED_WEEKS_KEPT);
  const documents = new Set(weeks.map((w) => w.itemId)).size;
  await sql`
    update learn.subject_preparation_steps
       set detail = ${sql.json({ ...detail, weeks, added: allAdded } as unknown as postgres.JSONValue)},
           counts = ${sql.json({ ...(step.counts ?? {}), weeks: weeks.length, documents })}
     where id = ${step.id} and user_id = ${userId}`;
  return true;
}

export async function addSourceToSubject(deps: {
  learn: LearnSupabaseClient;
  sql: postgres.Sql;
  userId: string;
  subjectId: string;
  ask: string;
  anthropicApiKey: string | undefined;
  /** Epoch ms by which the embedding stops, leaving the rest to the next pass. */
  deadline: number;
  spend: Spend;
}): Promise<AddSourceResult> {
  const { learn, sql, userId } = deps;
  const ask = readSourceAsk(deps.ask);
  if (ask.kind === 'error') return { ok: false, error: ask.error };

  const { data: subjectRow, error: subjectError } = await learn
    .from('subjects')
    .select('id, name, note, kind')
    .eq('user_id', userId)
    .eq('id', deps.subjectId)
    .maybeSingle();
  if (subjectError) return { ok: false, error: `The subject could not be read: ${subjectError.message}` };
  if (!subjectRow) return { ok: false, error: 'That subject is gone.' };
  const subject = subjectRow as { id: string; name: string; note: string | null; kind: string | null };

  let stored: Stored[];
  if (ask.kind === 'url') {
    const pulled = await pullAddress(ask.url);
    if (!pulled.ok) return { ok: false, error: pulled.detail };
    const kept = await storeStructure(sql, pulled.document);
    stored = [
      { itemId: kept.itemId, title: pulled.document.title, licence: pulled.document.licenceMode, units: pulled.document.units.length, unchanged: kept.unchanged },
    ];
  } else {
    const found = await pullPhrase({ sql, phrase: ask.phrase, subject, anthropicApiKey: deps.anthropicApiKey, spend: deps.spend });
    if (!found.ok) return { ok: false, error: found.detail };
    stored = await describe(sql, found.itemIds);
  }

  const asked = ask.kind === 'url' ? ask.url : ask.phrase;
  const { error: rowError } = await learn
    .from('subject_sources')
    .upsert(
      stored.map((s) => ({ user_id: userId, subject_id: subject.id, item_id: s.itemId, asked })),
      { onConflict: 'subject_id,item_id', ignoreDuplicates: true },
    );
  if (rowError) return { ok: false, error: `The document is in the bank, but adding it to this subject failed: ${rowError.message}` };

  let joined = false;
  let note: string | null = null;
  try {
    if (await embedNew(sql, userId, deps.deadline)) {
      joined = await joinMatchedWeeks(sql, userId, subject, stored.map((s) => s.itemId), deps.spend);
    } else {
      note = 'Embedding its weeks ran out of time. Add the same source again to finish matching them.';
    }
  } catch (error) {
    note = `Matching its weeks failed (${error instanceof Error ? error.message : String(error)}); add the same source again to try once more.`;
  }

  const lines = stored.map((s) =>
    addedLine({ title: s.title, licence: licenceLabel(s.licence), units: s.units, weeksJoined: joined, unchanged: s.unchanged }),
  );
  return { ok: true, lines: note ? [...lines, note] : lines };
}

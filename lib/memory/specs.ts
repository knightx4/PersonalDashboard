import 'server-only';

import { createHash } from 'node:crypto';
import { SPECS, readSpec, type SpecDoc } from '@/lib/specs/registry';
import { splitSections } from '@/lib/specs/sections';

/**
 * The specs in docs/, for search by meaning (plan #1321).
 *
 * SQL cannot read files, so each sweep reads the specs here, cuts them at
 * their `##` headings the way read_spec and the spec pages do, and copies the
 * sections that changed into core.memory_documents. core.memory_sources reads
 * them from there with the comments under each section, and the ordinary
 * staleness check re-embeds what changed. A spec edited and deployed is
 * therefore embedded again on the first tick after the deploy.
 */

/** The source table spec sections are embedded and cited under; the ref is `<slug>#<anchor>`. */
export const SPEC_SOURCE = 'docs.specs';

export type MemoryDocument = {
  sourceRef: string;
  title: string;
  body: string;
  textHash: string;
};

/** Every section of every spec that could be read, and how many specs could not. */
export async function specDocuments(
  read: (spec: SpecDoc) => Promise<string | null> = readSpec,
): Promise<{ documents: MemoryDocument[]; missing: number }> {
  const documents: MemoryDocument[] = [];
  let missing = 0;
  for (const spec of SPECS) {
    const markdown = await read(spec).catch(() => null);
    if (markdown === null) {
      missing += 1;
      continue;
    }
    for (const section of splitSections(markdown)) {
      const title = `${spec.title}: ${section.heading}`;
      documents.push({
        sourceRef: `${spec.slug}#${section.anchor}`,
        title,
        body: section.body,
        textHash: createHash('sha256').update(`${title}\u001f${section.body}`).digest('hex'),
      });
    }
  }
  return { documents, missing };
}

/** The part of a core-schema client this needs. */
export type DocumentsRpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Bring the owner's copies of the spec sections in line with the files.
 * Sends only the sections whose hash changed. When no spec could be read at
 * all (docs/ missing from a deployment), nothing is touched, so a packaging
 * mistake cannot wipe the specs' passages. Returns the rows removed or written.
 */
export async function syncSpecDocuments(
  client: DocumentsRpcClient,
  read?: (spec: SpecDoc) => Promise<string | null>,
): Promise<number> {
  const { documents, missing } = await specDocuments(read);
  if (documents.length === 0 || missing === SPECS.length) return 0;

  const { data, error } = await client.rpc('memory_document_hashes', { p_source_table: SPEC_SOURCE });
  if (error) throw new Error(`Reading spec copies failed: ${error.message}`);
  const had = new Map(
    ((data ?? []) as { source_ref: string; text_hash: string }[]).map((row) => [row.source_ref, row.text_hash]),
  );

  const changed = documents.filter((doc) => had.get(doc.sourceRef) !== doc.textHash);
  const refs = documents.map((doc) => doc.sourceRef);
  if (changed.length === 0 && [...had.keys()].every((ref) => refs.includes(ref))) return 0;

  const { data: count, error: syncError } = await client.rpc('sync_memory_documents', {
    p_source_table: SPEC_SOURCE,
    p_refs: refs,
    p_rows: changed.map((doc) => ({
      source_ref: doc.sourceRef,
      title: doc.title,
      body: doc.body,
      text_hash: doc.textHash,
    })),
  });
  if (syncError) throw new Error(`Copying spec sections failed: ${syncError.message}`);
  return typeof count === 'number' ? count : 0;
}

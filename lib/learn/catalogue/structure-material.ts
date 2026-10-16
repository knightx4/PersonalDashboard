import type postgres from 'postgres';
import { upsertItem, type Sql } from '@/lib/learn/catalogue/store';

/**
 * The material a structure document lists: lecture notes, slides, a reading
 * the provider hosts (plan #2247.3).
 *
 * Each piece is a catalogue item of its own, of kind `page` (an OCW resource
 * page, which is where the PDF is served), and belongs to its document
 * through `catalogue_course_items`, in the document's order, with the unit it
 * sits under as its label ("Session 3"). The same table orders a YouTube
 * course's lectures; here the course item is the structure document.
 *
 * Only the listing is written. The material's own text is not pulled here,
 * so the items have no segments yet and nothing searches them; the material
 * path reads the document's licence mode before it uses a word of them.
 */

export type StructureMaterialInput = {
  externalId: string;
  title: string;
  canonicalUrl: string;
  /** The unit it belongs to, verbatim. */
  providerLabel: string | null;
  /** Null when it follows the provider's licence; a sentence when it does not. */
  licence: string | null;
};

export type StoredStructureMaterial = { written: number; itemIds: string[] };

/**
 * Write a document's material and its order, replacing the order that was
 * there. Material no longer listed keeps its item (another document may list
 * it) but leaves this document's list.
 */
export async function storeStructureMaterial(
  sql: postgres.Sql,
  input: { structureItemId: string; providerSlug: string; material: readonly StructureMaterialInput[] },
): Promise<StoredStructureMaterial> {
  return sql.begin(async (tx) => writeStructureMaterial(tx, input)) as Promise<StoredStructureMaterial>;
}

async function writeStructureMaterial(
  tx: Sql,
  input: { structureItemId: string; providerSlug: string; material: readonly StructureMaterialInput[] },
): Promise<StoredStructureMaterial> {
  const [provider] = await tx<{ id: string }[]>`
    select id from learn.catalogue_providers where slug = ${input.providerSlug}`;
  if (!provider) throw new Error(`No catalogue provider called ${input.providerSlug}.`);

  const itemIds: string[] = [];
  const labels: (string | null)[] = [];
  for (const piece of input.material) {
    const itemId = await upsertItem(tx, provider.id, {
      externalId: piece.externalId,
      title: piece.title,
      kind: 'page',
      canonicalUrl: piece.canonicalUrl,
      lengthChars: null,
      durationSeconds: null,
      publishedAt: null,
    });
    await tx`update learn.catalogue_items set licence = ${piece.licence?.trim() || null} where id = ${itemId}`;
    if (!itemIds.includes(itemId)) {
      itemIds.push(itemId);
      labels.push(piece.providerLabel?.trim() || null);
    }
  }

  await tx`delete from learn.catalogue_course_items where course_item_id = ${input.structureItemId}`;
  const members = itemIds.map((memberItemId, position) => ({
    course_item_id: input.structureItemId,
    member_item_id: memberItemId,
    position,
    provider_label: labels[position],
  }));
  if (members.length > 0) {
    await tx`
      insert into learn.catalogue_course_items
        ${tx(members, 'course_item_id', 'member_item_id', 'position', 'provider_label')}`;
  }

  return { written: itemIds.length, itemIds };
}

export type ListedMaterial = {
  itemId: string;
  position: number;
  label: string | null;
  title: string;
  canonicalUrl: string;
  licence: string | null;
};

/** A document's material in its order. */
export async function readStructureMaterial(sql: Sql, structureItemId: string): Promise<ListedMaterial[]> {
  const rows = await sql<
    { item_id: string; position: number; provider_label: string | null; title: string; canonical_url: string; licence: string | null }[]
  >`
    select i.id as item_id, m.position, m.provider_label, i.title, i.canonical_url, i.licence
      from learn.catalogue_course_items m
      join learn.catalogue_items i on i.id = m.member_item_id
     where m.course_item_id = ${structureItemId}
     order by m.position`;
  return rows.map((row) => ({
    itemId: row.item_id,
    position: row.position,
    label: row.provider_label,
    title: row.title,
    canonicalUrl: row.canonical_url,
    licence: row.licence,
  }));
}

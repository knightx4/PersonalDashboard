/**
 * Put things on a shared form from the command line.
 *
 *   npx tsx scripts/share-add.ts list
 *   npx tsx scripts/share-add.ts add --share <slug|id> --category board-games
 *   npx tsx scripts/share-add.ts add --share <slug|id> --tag heavy-euro --dry-run
 *   npx tsx scripts/share-add.ts add --share <slug|id> --games --match monopoly
 *   npx tsx scripts/share-add.ts regroup --share <slug|id>
 *
 * This exists so "put all my board games on the form" is one command rather
 * than a UI errand -- the AI-facing surface described in
 * docs/SHARE-LINKS-SPEC.md. The filter flags mirror lib/share/select-items.ts,
 * which mirrors the inventory page, so the three never drift into meaning
 * different things.
 *
 * A direct connection rather than lib/db/admin.ts, matching scripts/notes.ts:
 * that module is server-only and throws under plain node. Same service-role
 * credentials, and the same responsibility -- every query below filters by
 * user_id explicitly, because nothing else will.
 */
import postgres from 'postgres';
import { groupKeyFor, type GroupableItem } from '../lib/share/grouping';

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const command = argv[0] ?? 'help';
  const flags: Flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

type Db = ReturnType<typeof sql>;

/** Resolve --share, which may be a uuid or the start of a title. */
async function findShare(db: Db, needle: string) {
  const rows = await db<{ id: string; user_id: string; title: string }[]>`
    select id, user_id, title from share_links
     where id::text = ${needle} or title ilike ${`%${needle}%`}
     order by created_at desc limit 2`;

  if (rows.length === 0) {
    console.error(`No share matches "${needle}". Run \`list\` to see them.`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`"${needle}" matches more than one share. Use the id.`);
    process.exit(1);
  }
  return rows[0]!;
}

/** The same three tiers the app uses, sourced straight from SQL. */
async function candidatesFor(
  db: Db,
  userId: string,
  flags: Flags,
): Promise<Array<GroupableItem & { familyKey: string | null; displayName: string }>> {
  const category = typeof flags.category === 'string' ? flags.category : null;
  const tag = typeof flags.tag === 'string' ? flags.tag : null;
  const match = typeof flags.match === 'string' ? flags.match : null;
  const gamesOnly = flags.games === true;

  const rows = await db<
    Array<{
      id: string;
      name: string;
      short_name: string | null;
      fingerprint_loose: string | null;
      bgg_id: number | null;
      needs_confirmation: boolean | null;
      is_game: boolean;
      family_slug: string | null;
    }>
  >`
    select i.id, i.name, i.short_name, i.fingerprint_loose,
           gd.bgg_id, gd.needs_confirmation,
           (gd.inventory_item_id is not null) as is_game,
           f.slug as family_slug
      from inventory_items i
      left join game_details gd on gd.inventory_item_id = i.id
      left join categories c on c.id = i.category_id
      left join inventory_item_families iif
             on iif.inventory_item_id = i.id and iif.confirmed_at is not null
      left join item_families f on f.id = iif.family_id
     where i.user_id = ${userId}
       and i.status = 'owned'
       and (${category}::text is null or c.slug = ${category})
       and (${gamesOnly}::boolean = false or gd.inventory_item_id is not null)
       and (${match}::text is null
            or i.name ilike ${match ? `%${match}%` : ''}
            or i.short_name ilike ${match ? `%${match}%` : ''})
       and (${tag}::text is null or exists (
             select 1 from inventory_item_tags it
               join item_tags t on t.id = it.tag_id
              where it.inventory_item_id = i.id
                and t.user_id = ${userId}
                and t.slug = ${tag}))
     order by coalesce(i.short_name, i.name)`;

  return rows.map((row) => ({
    inventoryItemId: row.id,
    name: row.name,
    shortName: row.short_name,
    bggId: row.bgg_id,
    needsConfirmation: row.needs_confirmation ?? false,
    isGame: row.is_game,
    fingerprintLoose: row.fingerprint_loose,
    familyKey: row.family_slug,
    displayName: row.short_name?.trim() || row.name,
  }));
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const db = sql();

  try {
    if (command === 'list') {
      const rows = await db<
        { id: string; title: string; status: string; items: number; answers: number }[]
      >`
        select s.id, s.title, s.status,
               (select count(*) from share_link_items where share_link_id = s.id)::int as items,
               (select count(*) from share_link_responses where share_link_id = s.id)::int as answers
          from share_links s
         order by s.created_at desc`;
      for (const row of rows) {
        console.log(
          `${row.id}  ${row.status.padEnd(8)}  ${String(row.items).padStart(3)} items  ` +
            `${String(row.answers).padStart(3)} answered  ${row.title}`,
        );
      }
      return;
    }

    if (command === 'add') {
      if (typeof flags.share !== 'string') {
        console.error('Pass --share <slug|id>.');
        process.exit(1);
      }
      const share = await findShare(db, flags.share);
      const candidates = await candidatesFor(db, share.user_id, flags);

      if (candidates.length === 0) {
        console.log('Nothing matched.');
        return;
      }

      // Printed before writing, always. A bulk add onto a link someone else is
      // already looking at deserves a moment to check it is the right list.
      const groups = new Map<string, string[]>();
      for (const item of candidates) {
        const key = groupKeyFor(item);
        groups.set(key, [...(groups.get(key) ?? []), item.displayName]);
      }
      console.log(`${candidates.length} items in ${groups.size} groups for "${share.title}":`);
      for (const [key, names] of [...groups].sort()) {
        console.log(`  ${names[0]}${names.length > 1 ? ` × ${names.length}` : ''}  (${key})`);
      }

      if (flags['dry-run'] === true) {
        console.log('\nDry run — nothing written.');
        return;
      }

      // One statement per item rather than a bulk insert. A shelf is tens of
      // rows, not thousands, and `on conflict do nothing returning id` per row
      // is what makes the "added N, M already there" count exact -- which is
      // the number worth having when the command is run twice.
      let insertedCount = 0;
      for (const item of candidates) {
        const inserted = await db<{ id: string }[]>`
          insert into share_link_items
            (share_link_id, subject_type, subject_id, group_key, family_key)
          values (${share.id}, 'inventory_item', ${item.inventoryItemId},
                  ${groupKeyFor(item)}, ${item.familyKey})
          on conflict (share_link_id, subject_type, subject_id) do nothing
          returning id`;
        insertedCount += inserted.length;
      }

      await db`
        insert into share_link_events (share_link_id, kind, payload)
        values (${share.id}, 'item_added',
                ${db.json({ count: insertedCount, via: 'scripts/share-add' })})`;

      console.log(
        `\nAdded ${insertedCount}; ${candidates.length - insertedCount} already there.`,
      );
      return;
    }

    if (command === 'regroup') {
      if (typeof flags.share !== 'string') {
        console.error('Pass --share <slug|id>.');
        process.exit(1);
      }
      const share = await findShare(db, flags.share);
      const candidates = await candidatesFor(db, share.user_id, {});
      const byId = new Map(candidates.map((c) => [c.inventoryItemId, c]));

      const items = await db<{ id: string; subject_id: string; group_key: string }[]>`
        select id, subject_id, group_key from share_link_items
         where share_link_id = ${share.id} and subject_type = 'inventory_item'`;

      let changed = 0;
      for (const row of items) {
        const item = byId.get(row.subject_id);
        if (!item) continue;
        const next = groupKeyFor(item);
        if (next === row.group_key) continue;
        console.log(`  ${row.group_key} -> ${next}`);
        if (flags['dry-run'] !== true) {
          await db`
            update share_link_items
               set group_key = ${next}, family_key = ${item.familyKey}
             where id = ${row.id}`;
        }
        changed += 1;
      }
      console.log(
        changed === 0
          ? 'Grouping is current.'
          : `${changed} regrouped${flags['dry-run'] === true ? ' (dry run)' : ''}.`,
      );
      console.log(
        'Answers are NOT moved by this command. Use Regroup in the app, which ' +
          'carries them over where it can and says what it dropped.',
      );
      return;
    }

    console.log(
      [
        'Usage:',
        '  share-add.ts list',
        '  share-add.ts add --share <slug|id> [--category board-games] [--tag <slug>]',
        '                   [--games] [--match <text>] [--dry-run]',
        '  share-add.ts regroup --share <slug|id> [--dry-run]',
      ].join('\n'),
    );
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

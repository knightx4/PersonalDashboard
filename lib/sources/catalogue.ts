import { coreSources } from '@/lib/core/sources';
import { devSources } from '@/lib/dev/sources';
import { goalsSources } from '@/lib/goals/sources';
import { shoppingSources } from '@/lib/inventory/sources';
import { jobsSources } from '@/lib/jobs/sources';
import { learnSources } from '@/lib/learn/sources';
import { newsSources } from '@/lib/news/sources';
import { todoSources } from '@/lib/todo/sources';
import { vaultSources } from '@/lib/vault/sources';
import { SOURCE_WEIGHTS, type ModuleSources, type NotASource, type Source } from './types';

/**
 * Every module's sources, gathered (lib/sources/types.ts). Goals reads this
 * to know where to look; tests/sources-catalogue.test.ts holds it to the
 * database, so it cannot fall behind a new table.
 *
 * A module with tables adds its `sources.ts` to MODULES below. That is the
 * only edit outside the module.
 */
const MODULES: readonly ModuleSources[] = [
  jobsSources,
  vaultSources,
  learnSources,
  todoSources,
  newsSources,
  shoppingSources,
  goalsSources,
  coreSources,
  devSources,
];

/**
 * The schemas the catalogue covers: every one the migrations in this
 * repository create. Two things in the same project are left out because no
 * migration here creates them, so the gate cannot see them: the `cashflow`
 * schema, and the `public.ask_ai_*` tables behind the public portfolio's Ask
 * AI, which hold visitors' questions rather than anything of the person's.
 */
export const SOURCE_SCHEMAS: readonly string[] = [
  'public',
  'core',
  'job_search',
  'obsidian',
  'todo',
  'learn',
  'news',
  'goals',
];

/**
 * Tables declared before their migration reached main, each with the file
 * that will create it. The gate lets these be missing from the database; once
 * the file lands, the entry here is stale and can go.
 */
export const AWAITING_MIGRATION: Readonly<Record<string, string>> = {};

export const SOURCES: readonly Source[] = MODULES.flatMap((m) => m.sources);
export const NOT_SOURCES: readonly NotASource[] = MODULES.flatMap((m) => m.notSources);

const byTable = new Map(SOURCES.map((source) => [source.table, source]));

/** The source for `schema.table`, or null when it is not one. */
export function sourceFor(table: string): Source | null {
  return byTable.get(table) ?? null;
}

/** Where one row of a source opens in the app, or null when it has no page. */
export function sourceHref(table: string, ref: string): string | null {
  const source = byTable.get(table);
  return source?.href ? source.href(ref) : null;
}

/** The module a source belongs to, as the page names it; the schema for one not listed. */
export function sourceModule(table: string): string {
  return byTable.get(table)?.module ?? table.split('.')[0];
}

/** Stands in for a row's ref when an href is written into the catalogue; survives URL encoding. */
const REF = '__REF__';

const WEIGHT_HEADINGS: Record<Source['weight'], string> = {
  intent: 'What they said they want (read first, quote rather than paraphrase)',
  record: 'What they did or have (read for progress and facts)',
  incidental: 'Mentions (leads only)',
};

/**
 * The catalogue as the goals routine reads it:
 * .claude/skills/goals/reference/sources.md. Written by
 * `npm run sources:write`; lib/sources/catalogue.test.ts fails when the file
 * and this disagree, so the routine never reads a stale list.
 */
export function catalogueMarkdown(): string {
  const lines = [
    '# Where to look',
    '',
    '<!-- Written by `npm run sources:write` from lib/sources/catalogue.ts. Do not edit by hand. -->',
    '',
    'Every table in the app that can tell you something about a goal, grouped by how much it',
    'says about what the person wants. Each is scoped to the person by `user_id` unless it says',
    'otherwise. The goals skill, "Pulling in from the other modules", says how to use it.',
    '',
  ];
  for (const weight of SOURCE_WEIGHTS) {
    const sources = SOURCES.filter((s) => s.weight === weight);
    if (sources.length === 0) continue;
    lines.push(`## ${WEIGHT_HEADINGS[weight]}`, '');
    for (const s of sources) {
      lines.push(`### \`${s.table}\` (${s.module})`, '', s.holds, '');
      lines.push(`- Search: ${s.search.map((c) => `\`${c}\``).join(', ')}`);
      lines.push(`- Name a row by \`${s.title}\`; link it by \`${s.ref ?? 'id'}\``);
      if (s.owner) {
        lines.push(
          /^\w+$/.test(s.owner)
            ? `- Scoped to the person by \`${s.owner}\`, not user_id`
            : `- Scoped to the person through ${s.owner}`,
        );
      }
      if (s.href) {
        const ref = s.ref ?? 'id';
        lines.push(`- Opens at \`${s.href(REF).replace(REF, `<${ref}>`)}\``);
      }
      if (s.note) lines.push(`- ${s.note}`);
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

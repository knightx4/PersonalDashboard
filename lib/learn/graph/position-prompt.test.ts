import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { proposeFloor } from './floor';
import { conceptsFromBrief } from './from-brief';
import { conceptsFromNote } from './from-note';
import { conceptsFromPrior } from './from-prior';
import { generateChain } from './generate';
import {
  MAP_EDGE_RULE,
  MAP_EDGE_TYPES,
  NODE_RULE,
  POSITION_KIND_RULE,
  POSITION_KINDS,
  POSITION_RULE,
  QUOTE_RULE,
} from './position-prompt';

/**
 * What counts as a position lives in one fragment.
 *
 * Two things can quietly break that. A call can go back to carrying its own
 * copy of the node test, and the enums the prompt names can drift from the
 * ones the database accepts. Each is checked here without a network: every
 * extraction call is run against a stub client and the system prompt it sent
 * must contain the fragment, and the kinds and edge types are read out of the
 * migration that created them.
 */

function recordingClient() {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_chain', input: { too_vague: true } }],
  });
  return { client: { messages: { create } } as never, create };
}

const systemOf = (create: ReturnType<typeof vi.fn>) =>
  (create.mock.calls[0][0] as { system: string }).system;

const base = { existing: [], anthropicApiKey: 'test' };

const CALLS: [string, (client: never) => Promise<unknown>][] = [
  [
    'generateChain',
    (client) => generateChain({ ...base, goal: 'Why rates move', subject: null, client }),
  ],
  [
    'conceptsFromBrief',
    (client) =>
      conceptsFromBrief({ ...base, subject: null, briefing: 'Fees fell after the fork.', client }),
  ],
  [
    'conceptsFromNote',
    (client) =>
      conceptsFromNote({
        ...base,
        subject: 'Economics',
        readingTitle: 'A reading',
        note: 'Rates reach prices through expectations.',
        client,
      }),
  ],
  [
    'conceptsFromPrior',
    (client) =>
      conceptsFromPrior({
        ...base,
        subject: null,
        account: 'The central bank sets the rate.',
        client,
      }),
  ],
  [
    'proposeFloor',
    (client) =>
      proposeFloor({
        ...base,
        subject: 'Economics',
        concept: 'Sunk costs',
        claim: 'Money already spent is not a reason to continue.',
        client,
      }),
  ],
];

describe('the node test', () => {
  it.each(CALLS)('%s sends it from the shared fragment', async (_name, call) => {
    const { client, create } = recordingClient();
    await call(client);
    expect(create).toHaveBeenCalled();
    expect(systemOf(create)).toContain(NODE_RULE);
  });
});

describe('the position fragment', () => {
  it('is the node test, the kinds, the edges and the quote rule together', () => {
    for (const part of [NODE_RULE, POSITION_KIND_RULE, MAP_EDGE_RULE, QUOTE_RULE]) {
      expect(POSITION_RULE).toContain(part);
    }
  });

  it('names every kind and every writable edge type in the prompt', () => {
    for (const kind of POSITION_KINDS) expect(POSITION_KIND_RULE).toContain(`"${kind}"`);
    for (const type of MAP_EDGE_TYPES) expect(MAP_EDGE_RULE).toContain(`"${type}"`);
    expect(MAP_EDGE_RULE).not.toContain('"mentions"');
  });

  const migration = readFileSync(
    new URL('../../../supabase/migrations-vault/0002_vault_map.sql', import.meta.url),
    'utf8',
  );
  const enumValues = (name: string) => {
    const body = migration.match(
      new RegExp(`create type obsidian\\.${name} as enum \\(([^;]*)\\);`),
    )?.[1];
    return [...(body ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };

  it('uses the kinds the database accepts', () => {
    expect(enumValues('position_kind')).toEqual([...POSITION_KINDS]);
  });

  it('uses the edge types the database accepts, less the legacy one', () => {
    expect(enumValues('edge_type')).toEqual([...MAP_EDGE_TYPES, 'mentions']);
  });
});

import { LookupCapsScreen } from '@/app/dev/usage/lookups/lookups-view';
import { SONNET } from '@/lib/core/models';
import type { KeptLookup, LookupCapEntry } from '@/lib/dash/lookup-caps';

/**
 * Ran out of lookups under Usage in Dev (plan #3092), from fixtures: an eval
 * case cut short after twelve lookups, an Ask Dash question asked from a
 * page with a failed lookup, and a long question with long inputs.
 */

const NOW = new Date('2026-11-10T15:00:00Z');
const ZONE = 'Europe/London';

const roleSearches: KeptLookup[] = [
  { tool: 'search', input: { query: 'applied October' }, ok: true },
  { tool: 'list_rows', input: { table: 'job_search.roles', filter: { status: 'applied' } }, ok: true },
  { tool: 'open_row', input: { table: 'job_search.roles', ref: '6f1c2a90-1b7e-4a51-9c11-2f3e4d5a6b7c' }, ok: true },
  { tool: 'open_row', input: { table: 'job_search.roles', ref: '7a2d3b01-2c8f-4b62-8d22-3a4f5e6b7c8d' }, ok: true },
  { tool: 'open_row', input: { table: 'job_search.roles', ref: '8b3e4c12-3d90-4c73-9e33-4b5a6f7c8d9e' }, ok: true },
  { tool: 'search_mail', input: { query: 'application received', after: '2026-10-01' }, ok: true },
  { tool: 'read_mail', input: { id: '18c2f7a9e0b1' }, ok: true },
  { tool: 'read_mail', input: { id: '18c2f7a9e0b2' }, ok: true },
  { tool: 'open_row', input: { table: 'job_search.companies', ref: 'c-41' }, ok: false },
  { tool: 'list_rows', input: { table: 'job_search.interviews', filter: { after: '2026-10-01' } }, ok: true },
  { tool: 'open_row', input: { table: 'job_search.roles', ref: '9c4f5d23-4ea1-4d84-8f44-5c6b7a8d9e0f' }, ok: true },
  { tool: 'open_row', input: { table: 'job_search.roles', ref: 'ad506e34-5fb2-4e95-9a55-6d7c8b9e0f1a' }, ok: true },
];

export const LOOKUP_CAP_FIXTURES: LookupCapEntry[] = [
  {
    id: 'cap-1',
    at: '2026-11-10T13:42:00Z',
    surface: 'eval',
    question: 'Which roles did I apply to in October, and which of them have I heard back from?',
    conversationId: null,
    turnId: null,
    pagePath: null,
    scope: null,
    evalRunId: '72ff0ba5-4d1e-4a7b-9c3f-1e2d3c4b5a69',
    evalCaseId: '62345130-9a8b-4c7d-8e6f-5a4b3c2d1e0f',
    lookups: roleSearches,
    lookupCount: 12,
    extended: false,
    cutShort: true,
    seconds: 59,
    costMicros: 182_400,
    model: SONNET,
  },
  {
    id: 'cap-2',
    at: '2026-11-09T18:05:00Z',
    surface: 'ask',
    question: 'What did I spend on groceries each week since August, split by shop?',
    conversationId: '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9',
    turnId: '1c2d3e4f-5061-4728-93a4-b5c6d7e8f901',
    pagePath: '/finances/spending',
    scope: null,
    evalRunId: null,
    evalCaseId: null,
    lookups: Array.from({ length: 12 }, (_, i) => ({
      tool: 'query_rows',
      input: { table: 'finances.transactions', week: `2026-W${32 + i}`, category: 'groceries' },
      ok: true,
    })),
    lookupCount: 12,
    extended: false,
    cutShort: false,
    seconds: 41.3,
    costMicros: 96_100,
    model: SONNET,
  },
  {
    id: 'cap-3',
    at: '2026-11-02T09:15:00Z',
    surface: 'ask',
    question:
      'Go through every goal in my career area and tell me, for each one, which steps are overdue, which are waiting on somebody else, and which I could close today from what is already in my notes and mail',
    conversationId: '2d3e4f50-6172-4839-a4b5-c6d7e8f90a12',
    turnId: '3e4f5061-7283-494a-b5c6-d7e8f90a1b23',
    pagePath: null,
    scope: 'goals',
    evalRunId: null,
    evalCaseId: null,
    lookups: Array.from({ length: 12 }, (_, i) => ({
      tool: i % 3 === 0 ? 'search' : 'open_row',
      input:
        i % 3 === 0
          ? { query: 'career goal steps overdue waiting', area: 'career', include: ['notes', 'mail', 'steps'] }
          : { table: 'goals.items', ref: `0000000${i}-aaaa-4bbb-8ccc-ddddeeeeffff` },
      ok: i !== 7,
    })),
    lookupCount: 12,
    extended: false,
    cutShort: false,
    seconds: 8.4,
    costMicros: null,
    model: SONNET,
  },
];

export function DevLookupCapsSurface({ open = false }: { open?: boolean }) {
  return <LookupCapsScreen entries={LOOKUP_CAP_FIXTURES} timeZone={ZONE} now={NOW} openFirst={open} />;
}

export function DevLookupCapsEmptySurface() {
  return <LookupCapsScreen entries={[]} timeZone={ZONE} now={NOW} />;
}

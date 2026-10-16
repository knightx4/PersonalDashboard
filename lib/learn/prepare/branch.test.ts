import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TerritoryTopic } from '@/lib/learn/levels/territory';
import {
  BRANCH_STEPS,
  branchKey,
  DIRECTION_ANSWERS,
  directionOffer,
  readBranch,
  readDirection,
  searchSubject,
  storedBranch,
  territoryBranches,
} from './branch';
import { PREPARATION_STEPS } from './steps';

const topic = (ask: string, frame: string): TerritoryTopic => ({ ask, scope: ask, frame, target: 4, from: [] });

const TERRITORY = {
  topics: [
    topic('Monthly recurring revenue', 'Revenue'),
    topic('Gross churn', 'Churn'),
    topic('Bookings', 'Revenue'),
    topic('Net retention', 'Churn'),
    topic('Cohorts', 'Churn'),
    topic('CAC', 'Unit economics'),
    topic('Payback', 'Unit economics'),
    topic('Board decks', 'Reporting'),
    topic('Deferred revenue', 'Revenue'),
    topic('LTV', 'Unit economics'),
    topic('Benchmarks', 'Benchmarking'),
    topic('Peer sets', 'Benchmarking'),
  ],
};

describe('the branches of a territory', () => {
  it('groups topics by frame, largest first, ties in the order first met', () => {
    const branches = territoryBranches(TERRITORY);
    expect(branches.map((b) => b.name)).toEqual(['Revenue', 'Churn', 'Unit economics', 'Benchmarking']);
    expect(branches[0]).toMatchObject({
      key: 'revenue',
      topics: 3,
      asks: ['Monthly recurring revenue', 'Bookings', 'Deferred revenue'],
      leadsTo: ['Monthly recurring revenue', 'Bookings', 'Deferred revenue'],
    });
  });

  it('leaves out a frame with one topic: one topic is not a direction', () => {
    expect(territoryBranches(TERRITORY).some((b) => b.name === 'Reporting')).toBe(false);
  });

  it('keys a frame the same way every time', () => {
    expect(branchKey('Customer Retention & Churn')).toBe('customer-retention-churn');
    expect(branchKey('***')).toBe('branch');
  });
});

describe('the direction offer', () => {
  const base = { territory: TERRITORY, taken: new Set<string>(), prepared: true, direction: null };

  it('is not made before thirty graded answers', () => {
    expect(directionOffer({ ...base, answers: DIRECTION_ANSWERS - 1 })).toBeNull();
    expect(directionOffer({ ...base, answers: DIRECTION_ANSWERS })?.branches).toHaveLength(4);
  });

  it('waits for the subject to be prepared', () => {
    expect(directionOffer({ ...base, answers: 40, prepared: false })).toBeNull();
    expect(directionOffer({ ...base, answers: 40, territory: null })).toBeNull();
  });

  it('comes back thirty answers after a pick or a dismissal, without the branch picked', () => {
    const picked = { state: 'picked' as const, key: 'revenue', name: 'Revenue', answers: 31, at: '' };
    const taken = new Set(['revenue']);
    expect(directionOffer({ ...base, answers: 60, direction: picked, taken })).toBeNull();
    const again = directionOffer({ ...base, answers: 61, direction: picked, taken });
    expect(again?.branches.map((b) => b.key)).toEqual(['churn', 'unit-economics', 'benchmarking']);

    const dismissed = { state: 'dismissed' as const, answers: 35, at: '' };
    expect(directionOffer({ ...base, answers: 64, direction: dismissed })).toBeNull();
    expect(directionOffer({ ...base, answers: 65, direction: dismissed })).not.toBeNull();
  });

  it('is not made with fewer than two branches left', () => {
    const taken = new Set(['revenue', 'churn', 'unit-economics']);
    expect(directionOffer({ ...base, answers: 90, taken })).toBeNull();
  });
});

describe('a branch run', () => {
  it('opens the five steps the migration opens, in the runner order', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations-learn/0171_subject_preparation_branches.sql'), 'utf8');
    const block = sql.match(/insert into learn\.subject_preparation_steps \(preparation_id, user_id, key, ordinal\)\s+values([\s\S]*?);/);
    expect(block).not.toBeNull();
    const rows = [...block![1].matchAll(/'([a-z_]+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])]);
    expect(rows).toEqual(BRANCH_STEPS.map((key) => [key, PREPARATION_STEPS.indexOf(key) + 1]));
  });

  it('searches beneath its branch, naming what is already laid out', () => {
    const [branch] = territoryBranches(TERRITORY);
    const search = searchSubject({ name: 'SaaS metrics', note: 'For board decks.', branch: storedBranch(branch) });
    expect(search.name).toBe('SaaS metrics: Revenue');
    expect(search.note).toContain('For board decks.');
    expect(search.note).toContain('Going deeper on Revenue.');
    expect(search.note).toContain('Monthly recurring revenue; Bookings; Deferred revenue');
    expect(searchSubject({ name: 'SaaS metrics', note: null })).toEqual({ name: 'SaaS metrics', note: null });
  });

  it('reads its stored branch and the stored direction back, and nothing that is not one', () => {
    expect(readBranch({ key: 'revenue', frame: 'Revenue', name: 'Revenue', asks: ['A', 3] })).toEqual({
      key: 'revenue',
      frame: 'Revenue',
      name: 'Revenue',
      asks: ['A'],
    });
    expect(readBranch(null)).toBeNull();
    expect(readBranch({ frame: 'Revenue' })).toBeNull();
    expect(readDirection({ state: 'dismissed', answers: 31, at: 'x' })).toEqual({ state: 'dismissed', answers: 31, at: 'x' });
    expect(readDirection({ state: 'picked', key: 'k', answers: 40 })).toMatchObject({ state: 'picked', key: 'k', name: 'k' });
    expect(readDirection({ state: 'other' })).toBeNull();
  });
});

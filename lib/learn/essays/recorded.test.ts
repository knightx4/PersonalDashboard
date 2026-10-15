import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import gold from './fixtures/gold-sox-ai.json';
import { readEvidence } from './evidence';
import { scoreAgainstGold, type GoldSource } from './gold';
import { readMap } from './research-map';
import { EVIDENCE_KINDS, type EvidenceKind } from './plan';

/**
 * Real responses, replayed. Each file in fixtures/recorded is one model call
 * as learn.essay_log kept it (migration learn 0133): the operation, the
 * prompt, and the response's content blocks with the encrypted payloads
 * removed. The parsers are run on what the API actually returned, so a
 * change in its shape, or in how the model writes, fails here rather than on
 * someone's essay. Hand-made fixtures in the other tests check the rules;
 * these check reality.
 *
 * To add one: select the payload of a 'call' row from learn.essay_log and
 * save it as fixtures/recorded/<action>-<date>-<n>.json with its action.
 */

type Recorded = {
  action: string;
  kind?: EvidenceKind;
  prompt: string;
  model: string;
  content: unknown[];
};

const DIR = join(__dirname, 'fixtures', 'recorded');
// Git keeps no empty folder, so there is none until the first recording is added.
const FILES = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
const load = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Recorded;

describe('recorded responses', () => {
  if (FILES.length === 0)
    it.todo(
      'record a real response: run research or an evidence search in the app, then save its log row here',
    );

  it.each(FILES.filter((f) => load(f).action === 'research-essay-question'))(
    '%s reads as a write-up',
    (file) => {
      const map = readMap(load(file).content);
      expect(map.findings.filter((f) => f.kind !== 'debate').length).toBeGreaterThan(0);
      for (const finding of map.findings) {
        for (const c of finding.citations) expect(map.sources[c.source]).toBeDefined();
      }
      const score = scoreAgainstGold(map.sources, gold.sources as GoldSource[]);
      expect(score.stale).toEqual([]);
    },
  );

  it.each(FILES.filter((f) => load(f).action === 'find-point-evidence'))(
    '%s reads as evidence',
    (file) => {
      const recorded = load(file);
      const kind = recorded.kind && EVIDENCE_KINDS.includes(recorded.kind) ? recorded.kind : 'for';
      const items = readEvidence(recorded.content, kind);
      for (const item of items) {
        expect(item.url).toMatch(/^https?:\/\//);
        expect(item.quote.length).toBeGreaterThan(0);
      }
    },
  );
});

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { SPEC_COUNTERS } from '../../scripts/spec-counts';
import { HAIKU, HAIKU_DATED, MODELS, OPUS, SONNET } from './models';

const ROOT = join(__dirname, '../..');

describe('model ids', () => {
  it('are spelled in lib/core/models.ts and nowhere else outside the tests', () => {
    // The same rule as the spec's `model-id-files` counter, held at its target of one.
    const counter = SPEC_COUNTERS.find((c) => c.name === 'model-id-files');
    expect(counter).toBeDefined();
    expect(counter!.measure(ROOT)).toEqual(['lib/core/models.ts']);
  });

  it('name one of the four tiers at every call site', () => {
    const tiers: string[] = [OPUS, SONNET, HAIKU, HAIKU_DATED];
    for (const id of Object.values(MODELS)) expect(tiers).toContain(id);
  });
});

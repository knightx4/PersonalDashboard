import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { SPEC_COUNTERS } from '../../scripts/spec-counts';
import { DASH_CHOICES, HAIKU, MODELS, OPUS, SONNET } from './models';
import { MODEL_RULES, rulesFor } from './model-rules';

const ROOT = join(__dirname, '../..');

describe('model ids', () => {
  it('are spelled in lib/core/models.ts and nowhere else outside the tests', () => {
    // The same rule as the spec's `model-id-files` counter, held at its target of one.
    const counter = SPEC_COUNTERS.find((c) => c.name === 'model-id-files');
    expect(counter).toBeDefined();
    expect(counter!.measure(ROOT)).toEqual(['lib/core/models.ts']);
  });

  it('name one of the three tiers at every call site', () => {
    const tiers: string[] = [OPUS, SONNET, HAIKU];
    for (const id of Object.values(MODELS)) expect(tiers).toContain(id);
  });
});

describe('model rules (plan #2937.3)', () => {
  it('are written for every model a call site uses', () => {
    for (const [key, id] of Object.entries(MODELS)) {
      expect(rulesFor(id), `${key} uses ${id}, which has no entry in lib/core/model-rules.ts`).not.toBeNull();
    }
  });

  it('are written for every model a person can choose for Dash', () => {
    for (const choice of DASH_CHOICES) expect(rulesFor(choice.id)).not.toBeNull();
  });

  it('name no model the app does not call', () => {
    const called = new Set<string>([...Object.values(MODELS), ...DASH_CHOICES.map((c) => c.id)]);
    for (const id of Object.keys(MODEL_RULES)) expect(called).toContain(id);
  });

  it('allow the strict answer tool runDash sends to every Dash model', () => {
    // lib/dash/loop.ts sends its answer tool with strict: true whatever the model.
    for (const choice of DASH_CHOICES) expect(rulesFor(choice.id)!.strictTools).toBe(true);
  });

  it('give a model that writes progress notes a display that returns them', () => {
    for (const rules of Object.values(MODEL_RULES)) {
      if (rules.progressNotes) expect(rules.notesDisplay).toBe('updates');
    }
  });

  it('leave a model that cannot force its tool a way to report in shape', () => {
    // A report-only call that cannot force its tool needs a strict tool or structured output.
    for (const rules of Object.values(MODEL_RULES)) {
      if (!rules.forcedTool) expect(rules.strictTools || rules.structuredOutput).toBe(true);
    }
  });

  it('turn thinking off only in a form the model takes', () => {
    expect(MODEL_RULES[OPUS].thinkingOff).toBeNull();
    expect(MODEL_RULES[SONNET].thinkingOff).toBe('between_tools');
    expect(MODEL_RULES[HAIKU].thinkingOff).toBe('disabled');
  });
});

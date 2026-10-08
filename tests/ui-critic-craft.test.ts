/**
 * The critic's craft checklist (plan #1566, docs/UI-QUALITY-SPEC.md Part 8)
 * reads the strips `npm run record` makes. These hold the agent's
 * instructions to what the recorder really writes, so renaming a strip or a
 * frame label cannot leave the critic looking for something that is not
 * there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAME_MS, INPUT_AT_MS, inputEvents, phaseAt, stripName } from '@/lib/preview/interaction';

const root = join(__dirname, '..');
const critic = readFileSync(join(root, '.claude/agents/ui-critic.md'), 'utf8');
const building = readFileSync(join(root, '.claude/skills/plan/reference/building.md'), 'utf8');

const box = { x: 0, y: 100, width: 390, height: 300 };

describe('the critic craft checklist', () => {
  it('names the strip where the recorder writes it', () => {
    expect(critic).toContain(`.preview-shots/strips/${stripName('<id>', 'light')}.png`);
    expect(critic).toContain(`${stripName('<id>', 'light')}.json`);
  });

  it('reads the frame labels the recorder prints', () => {
    const press = inputEvents({ kind: 'press', target: 'button', shows: '' }, box, 844);
    const swipe = inputEvents({ kind: 'swipe', target: 'div', shows: '', direction: 'left' }, box, 844);
    const labels = new Set<string>();
    for (const events of [press, swipe]) {
      for (let at = 0; at <= 1000; at += FRAME_MS) labels.add(phaseAt(events, at));
    }
    for (const label of labels) expect(critic, label).toContain(`\`${label}\``);
    const prose = critic.replace(/\s+/g, ' ');
    expect(prose).toContain(`one frame every ${FRAME_MS}ms`);
    expect(prose).toContain(`the input starts at ${INPUT_AT_MS}ms`);
  });

  it('cites each of the four craft checks', () => {
    for (const check of ['press', 'motion', 'moment', 'wording']) {
      expect(critic).toContain(`"craft:${check}"`);
    }
    expect(critic).toContain('`strip-light`');
  });

  it('is handed the strip and the moment by the builder', () => {
    expect(building).toContain('npm run record -- <id>');
    expect(building).toMatch(/the strip and its JSON or "none"/);
    expect(building).toContain('app/dev/ui/moments.ts');
  });
});

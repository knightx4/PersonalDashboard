import { describe, expect, it } from 'vitest';
import { HAIKU, MODELS, OPUS, SONNET } from './models';
import { PROGRESS_NOTES_BETA, rulesFor } from './model-rules';
import { forceTool, readReply, requestShape, strictTool, systemMessage } from './model-call';

const CALLED = [...new Set<string>(Object.values(MODELS))];

describe('building a request from the rules', () => {
  it('forces the tool only where the model takes a forced tool', () => {
    expect(forceTool('report', HAIKU)).toEqual({ type: 'tool', name: 'report' });
    expect(forceTool('report', OPUS)).toEqual({ type: 'auto' });
    expect(forceTool('report', SONNET)).toEqual({ type: 'auto' });
    expect(forceTool('report', 'claude-unknown')).toEqual({ type: 'auto' });
  });

  it('asks Opus and Sonnet for the display that returns progress notes, with its beta', () => {
    for (const model of [OPUS, SONNET]) {
      expect(requestShape(model)).toEqual({
        thinking: { thinking: { type: 'adaptive', display: 'updates' } },
        effort: {},
        beta: [PROGRESS_NOTES_BETA],
      });
    }
  });

  it('leaves Haiku thinking at its default, with no beta', () => {
    expect(requestShape(HAIKU, 'low')).toEqual({ thinking: {}, effort: { output_config: { effort: 'low' } }, beta: [] });
  });

  it('sends a display only to a model whose rules name one', () => {
    for (const id of CALLED) {
      const rules = rulesFor(id)!;
      const display = (requestShape(id).thinking as { thinking?: { display?: string } }).thinking?.display;
      expect(display ?? null).toBe(rules.progressNotes ? rules.notesDisplay : null);
    }
  });

  it('marks a tool strict where the model allows it', () => {
    const tool = { name: 'answer', input_schema: { type: 'object' as const } };
    for (const id of CALLED) expect('strict' in strictTool(tool, id)).toBe(rulesFor(id)!.strictTools);
    expect(strictTool(tool, 'claude-unknown')).toBe(tool);
  });

  it('sends an instruction as a system message to a model that takes one', () => {
    expect(systemMessage(SONNET, 'Answer now.')).toEqual({ role: 'system', content: 'Answer now.' });
    expect(systemMessage('claude-unknown', 'Answer now.')).toEqual({ role: 'user', content: 'Answer now.' });
  });
});

describe('reading a reply', () => {
  it('answered through the tool', () => {
    const read = readReply(
      { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'report' }], stop_reason: 'tool_use' },
      'report',
    );
    expect(read).toEqual({ kind: 'tool', reason: 'The call reported through report.' });
  });

  it('answered in text', () => {
    const read = readReply({ content: [{ type: 'text', text: 'Here it is.' }], stop_reason: 'end_turn' }, 'report');
    expect(read).toEqual({ kind: 'text', reason: 'The call answered in prose instead of reporting (stopped: end_turn).' });
  });

  it('answered out of sight, in a progress note', () => {
    const read = readReply({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'end_turn' }, 'report', SONNET);
    expect(read.kind).toBe('hidden');
    expect(read.reason).toContain('reported nothing');
    expect(read.reason).toContain('progress note');
    expect(read.reason).toContain('end_turn');
  });

  it('reports an empty reply from a model with no progress notes as nothing', () => {
    const read = readReply({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'end_turn' }, 'report', HAIKU);
    expect(read).toEqual({ kind: 'hidden', reason: 'The call ran but reported nothing (stopped: end_turn).' });
  });

  it('counts a blank text block as nothing to show', () => {
    expect(readReply({ content: [{ type: 'text', text: '  ' }], stop_reason: 'end_turn' }, 'report', HAIKU).kind).toBe('hidden');
  });

  it('does not count a lookup as the report', () => {
    const read = readReply({ content: [{ type: 'tool_use', name: 'search' }], stop_reason: 'tool_use' }, 'answer', HAIKU);
    expect(read.kind).toBe('hidden');
  });

  it('cut off, which is a budget problem', () => {
    const read = readReply({ content: [{ type: 'text', text: 'Half' }], stop_reason: 'max_tokens' }, 'report');
    expect(read.kind).toBe('cut_off');
    expect(read.reason).toContain('cut off');
    expect(read.reason).toContain('too long');
  });

  it('refused, with the category and explanation when given', () => {
    const read = readReply(
      { content: [], stop_reason: 'refusal', stop_details: { category: 'cyber', explanation: 'It reads as an attack.' } },
      'report',
    );
    expect(read).toEqual({ kind: 'refused', reason: 'The model declined to answer (cyber). It reads as an attack.' });
    expect(readReply({ content: [], stop_reason: 'refusal', stop_details: null }).reason).toBe('The model declined to answer.');
  });

  it('survives a stop reason the SDK did not give', () => {
    expect(readReply({ content: [] }).reason).toContain('unknown');
  });
});

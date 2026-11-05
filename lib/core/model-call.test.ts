import { describe, expect, it } from 'vitest';
import { HAIKU, MODELS, OPUS, SONNET } from './models';
import { PROGRESS_NOTES_BETA, rulesFor } from './model-rules';
import {
  forceTool,
  outputFormat,
  outputSchema,
  readReply,
  readReport,
  reportRequest,
  reportShape,
  requestShape,
  strictTool,
  systemMessage,
} from './model-call';

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
    expect(read.reason).toContain('budget');
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

const REPORT = {
  name: 'report_it',
  description: 'Report it.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: 3,
        minItems: 1,
        items: {
          type: 'object',
          properties: { score: { type: 'integer', minimum: 1, maximum: 10, description: 'How good.' }, note: { type: ['string', 'null'] } },
          required: ['score', 'note'],
        },
      },
      when: { type: 'string', format: 'date' },
      slug: { type: 'string', format: 'slug', maxLength: 40 },
    },
    required: ['items'],
  },
};

describe('a report-only call (plan #2937.4)', () => {
  it('forces the tool where the model takes one, and asks for structured output where it does not', () => {
    expect(reportShape(HAIKU)).toBe('forced_tool');
    expect(reportShape(OPUS)).toBe('structured_output');
    expect(reportShape(SONNET)).toBe('structured_output');
    expect(reportShape('claude-unknown')).toBe('chosen_tool');
  });

  it('never leaves a model the app calls to choose whether to report', () => {
    for (const model of CALLED) expect(reportShape(model)).not.toBe('chosen_tool');
  });

  it('builds the request for each shape', () => {
    expect(reportRequest(REPORT, HAIKU)).toEqual({ tools: [REPORT], tool_choice: { type: 'tool', name: 'report_it' } });
    const structured = reportRequest(REPORT, SONNET) as unknown as { output_config: { format: { type: string; schema: unknown } } };
    expect(Object.keys(structured)).toEqual(['output_config']);
    expect(structured.output_config.format.type).toBe('json_schema');
    expect(structured.output_config.format.schema).toEqual(outputSchema(REPORT.input_schema));
    expect(reportRequest(REPORT, 'claude-unknown')).toEqual({ tools: [REPORT], tool_choice: { type: 'auto' } });
  });

  it('puts effort in the same output_config as the format', () => {
    expect(reportRequest(REPORT, OPUS, 'low')).toMatchObject({ output_config: { effort: 'low', format: { type: 'json_schema' } } });
    expect(reportRequest(REPORT, HAIKU, 'low')).toMatchObject({ output_config: { effort: 'low' }, tool_choice: { type: 'tool' } });
  });

  it('gives no output format to a model that does not take one', () => {
    expect(outputFormat(REPORT.input_schema, 'claude-unknown')).toBeNull();
  });

  it('closes every object and moves the constraints structured output refuses into the description', () => {
    const schema = outputSchema(REPORT.input_schema) as {
      additionalProperties: boolean;
      properties: {
        items: { minItems: number; description: string; items: { additionalProperties: boolean; properties: { score: Record<string, unknown> } } };
        when: Record<string, unknown>;
        slug: Record<string, unknown>;
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.items.items.additionalProperties).toBe(false);
    expect(schema.properties.items.minItems).toBe(1);
    expect(schema.properties.items.description).toBe('(at most 3 items)');
    expect(schema.properties.items.items.properties.score).toEqual({ type: 'integer', description: 'How good. (at least 1; at most 10)' });
    expect(schema.properties.when).toEqual({ type: 'string', format: 'date' });
    expect(schema.properties.slug).toEqual({ type: 'string', description: '(at most 40 characters)' });
  });

  it('keeps a property whose name is a schema keyword', () => {
    const schema = outputSchema({ type: 'object', properties: { description: { type: 'string' }, maximum: { type: 'number' } } });
    expect(schema).toEqual({
      type: 'object',
      properties: { description: { type: 'string' }, maximum: { type: 'number' } },
      additionalProperties: false,
    });
  });

  it('reads the report from the tool or from the structured text', () => {
    expect(readReport({ content: [{ type: 'tool_use', name: 'report_it', input: { a: 1 } }], stop_reason: 'tool_use' }, 'report_it', HAIKU)).toEqual({ ok: true, value: { a: 1 } });
    expect(
      readReport({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a": 2}' }], stop_reason: 'end_turn' }, 'report_it', OPUS),
    ).toEqual({ ok: true, value: { a: 2 } });
  });

  it('names a structured reply that is not JSON', () => {
    const read = readReport({ content: [{ type: 'text', text: 'Here you go' }], stop_reason: 'end_turn' }, 'report_it', SONNET);
    expect(read).toMatchObject({ ok: false, kind: 'unreadable' });
  });

  it('says a reply was cut off rather than reading half a report', () => {
    const read = readReport({ content: [{ type: 'text', text: '{"a": ' }], stop_reason: 'max_tokens' }, 'report_it', OPUS);
    expect(read).toMatchObject({ ok: false, kind: 'cut_off' });
  });

  it('treats prose as prose where the call asked for a tool', () => {
    const read = readReport({ content: [{ type: 'text', text: '{"a": 3}' }], stop_reason: 'end_turn' }, 'report_it', HAIKU);
    expect(read).toMatchObject({ ok: false, kind: 'text' });
  });
});

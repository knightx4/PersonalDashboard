import { describe, expect, it } from 'vitest';
import { forceTool, toolBlockIn, whyNoReport } from '@/lib/learn/graph/tool-call';

describe('forceTool', () => {
  it('names the tool the model has to report through', () => {
    expect(forceTool('report_claims')).toEqual({ type: 'tool', name: 'report_claims' });
  });
});

describe('finding the block', () => {
  it('takes the block for the tool that was asked for', () => {
    const reply = {
      content: [
        { type: 'text' },
        { type: 'tool_use', name: 'report_grade' },
        { type: 'tool_use', name: 'report_claims' },
      ],
      stop_reason: 'tool_use',
    };
    expect(toolBlockIn(reply, 'report_claims')).toEqual({
      type: 'tool_use',
      name: 'report_claims',
    });
  });

  it('is null when the model called nothing', () => {
    expect(toolBlockIn({ content: [{ type: 'text' }], stop_reason: 'end_turn' }, 'x')).toBeNull();
  });
});

describe('why there is no report', () => {
  it('calls out a reply that was cut off, which is a budget problem', () => {
    const why = whyNoReport({ content: [{ type: 'text' }], stop_reason: 'max_tokens' });
    expect(why).toContain('cut off');
    expect(why).toContain('too long');
  });

  it('says so when the model answered in prose instead', () => {
    // What a note full of formulas did before the tool was forced.
    const why = whyNoReport({ content: [{ type: 'text' }], stop_reason: 'end_turn' });
    expect(why).toContain('prose');
    expect(why).toContain('end_turn');
  });

  it('reports an empty reply as itself, carrying the stop reason', () => {
    const why = whyNoReport({ content: [], stop_reason: 'end_turn' });
    expect(why).toContain('reported nothing');
    expect(why).toContain('end_turn');
  });

  it('survives a stop reason the SDK did not give', () => {
    expect(whyNoReport({ content: [] })).toContain('unknown');
  });
});

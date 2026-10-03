import { describe, expect, it } from 'vitest';
import {
  encodeStreamLine,
  heardLookup,
  lookupLabel,
  lookupOutcome,
  lookupWire,
  readAskStream,
  STREAM_CUT,
  turnLookups,
  type LookupWire,
} from './lookups';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('lookupLabel', () => {
  it('says each read in words, with what it was asked', () => {
    expect(lookupLabel('job_applications', {})).toBe('Checking job applications');
    expect(lookupLabel('search', { query: 'acme' })).toBe('Searching for “acme”');
    expect(lookupLabel('open_row', { table: 'vault.notes', ref: 'x' })).toBe('Opening one of your notes');
    expect(lookupLabel('search_mail', { from: 'Anthony' })).toBe('Searching email from “Anthony”');
    expect(lookupLabel('read_dev_row', { kind: 'step', ref: '#1248' })).toBe('Reading step #1248');
    expect(lookupLabel('made_up', {})).toBe('Looking something up');
  });

  it('cuts a long query', () => {
    expect(lookupLabel('recall', { question: 'a '.repeat(80) }).length).toBeLessThan(110);
  });
});

describe('the stream', () => {
  it('drops proposals and hand-offs, and carries a count instead of the rows', () => {
    expect(lookupWire({ phase: 'started', id: 'p', index: 0, name: 'propose_todo', input: {} })).toBeNull();
    expect(lookupWire({ phase: 'started', id: 'h', index: 0, name: 'hand_off', input: {} })).toBeNull();
    expect(
      lookupWire({
        phase: 'finished',
        id: 't1',
        index: 0,
        name: 'todos',
        input: {},
        ok: true,
        result: { ok: true, rows: [{}, {}, {}] },
      }),
    ).toEqual({ phase: 'finished', id: 't1', index: 0, name: 'todos', input: {}, ok: true, found: 3 });
  });

  it('turns a start into a running line and its finish into what it found', () => {
    const started: LookupWire = { phase: 'started', id: 'a', index: 0, name: 'todos', input: {} };
    let lines = heardLookup([], started);
    expect(lines).toEqual([{ id: 'a', label: 'Checking todos', state: 'running', found: null }]);
    expect(lookupOutcome(lines[0])).toBeNull();
    lines = heardLookup(lines, { ...started, phase: 'finished', ok: true, found: 0 });
    expect(lines).toHaveLength(1);
    expect(lookupOutcome(lines[0])).toBe('nothing found');
    // One refused at the cap is only ever heard finishing.
    lines = heardLookup(lines, { phase: 'finished', id: 'b', index: 8, name: 'courses', input: {}, ok: false });
    expect(lines[1]).toMatchObject({ state: 'failed' });
    expect(lookupOutcome(lines[1])).toBe('did not work');
  });

  it('reads lines split across chunks, hands over each lookup, and returns the result', async () => {
    const heard: LookupWire[] = [];
    const first = encodeStreamLine({ lookup: { phase: 'started', id: 'a', index: 0, name: 'todos', input: {} } });
    const last = encodeStreamLine({ result: { turns: [], stop: 'answered' } });
    const whole = first + last;
    const result = await readAskStream(streamOf([whole.slice(0, 10), whole.slice(10, first.length + 4), whole.slice(first.length + 4)]), (l) =>
      heard.push(l),
    );
    expect(heard.map((l) => l.id)).toEqual(['a']);
    expect(result).toEqual({ turns: [], stop: 'answered' });
  });

  it('says the answer stopped when the stream ends without one', async () => {
    const result = await readAskStream(streamOf(['{"lookup":']), () => {});
    expect(result.error).toBe(STREAM_CUT);
  });
});

describe('turnLookups', () => {
  it('reads a kept answer\'s lookups in order, reads only', () => {
    const lines = turnLookups([
      { name: 'job_applications', input: {}, result: { ok: true, rows: [{}, {}] } },
      { name: 'propose_todo', input: {}, result: { ok: true, rows: [] } },
      { name: 'search_mail', input: { words: 'lease' }, result: { ok: true, matched: 4 } },
      { name: 'read_mail', input: {}, result: { ok: false, error: 'no mailbox' } },
    ]);
    expect(lines.map((l) => [l.label, lookupOutcome(l)])).toEqual([
      ['Checking job applications', '2 found'],
      ['Searching email for “lease”', '4 found'],
      ['Reading an email', 'did not work'],
    ]);
  });
});

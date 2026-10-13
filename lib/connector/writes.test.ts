import { describe, expect, it, vi } from 'vitest';
import { CONNECTOR_WRITE_TOOLS, runConnectorWrite, type ConnectorWriteContext } from './writes';

/**
 * The connector's Learn writes (plan #1808) refuse bad input before reaching
 * the database, as an error the model can read and correct.
 */

const tool = (name: string) => CONNECTOR_WRITE_TOOLS.find((entry) => entry.definition.name === name)!;

function ctx(): ConnectorWriteContext {
  const touched = vi.fn(() => {
    throw new Error('the database was reached');
  });
  return {
    userId: 'me',
    learn: { from: touched } as never,
    core: { rpc: touched } as never,
    later: vi.fn(),
    recordSpend: vi.fn(async () => undefined),
    anthropicApiKey: undefined,
    lookupDeadline: 0,
  };
}

describe('runConnectorWrite', () => {
  it('offers the three writes, then the rest of Learn (plan #1894.8)', () => {
    expect(CONNECTOR_WRITE_TOOLS.map((entry) => entry.definition.name)).toEqual([
      'add_to_reading_list',
      'log_learning',
      'mark_read',
      'change_reading',
      'add_learn_track',
      'add_track_reading',
      'reword_concept',
      'add_concept_note',
      'change_video',
    ]);
  });

  it.each([
    ['add_to_reading_list', { items: [], subjects: ['Evals'] }, 'items must list at least one work.'],
    ['add_to_reading_list', { items: [{ title: 'DSPy' }] }, 'subjects must name at least one subject.'],
    ['add_to_reading_list', { items: [{ author: 'Stanford' }], subjects: ['Evals'] }, 'title is required.'],
    ['log_learning', { summary: 'x', subject: 'Evals' }, 'topic is required.'],
    ['log_learning', { topic: 'Evals', summary: 'x', subject: 'Evals', ideas: [{ name: 'A' }] }, 'claim is required.'],
    ['mark_read', {}, 'title is required.'],
    ['mark_read', { reading_id: 'not-an-id' }, "reading_id must be a reading's id."],
    ['change_reading', { reading_id: 'not-an-id' }, "reading_id must be a reading's id, as a lookup returned it."],
    ['add_learn_track', {}, 'title is missing: name the reading list.'],
    ['change_video', { video_id: 'short' }, 'video_id must be the YouTube video id, eleven characters, as a lookup returned it.'],
  ])('%s refuses %j', async (name, input, error) => {
    expect(await runConnectorWrite(tool(name), ctx(), input)).toEqual({ ok: false, error });
  });
});

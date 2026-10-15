import { describe, expect, it } from 'vitest';
import { BOX_COMMANDS, boxTrigger, commandsFor, replaceTrigger } from './box-commands';
import { parseAskInput, parseAskMentions, MAX_MENTIONS } from './ask-input';
import { ASK_VOICE, scopedVoice } from '@/lib/dash/ask';
import { lookupInScope } from '@/lib/ask/tools';
import { encodeStreamLine, readAskStream, STREAM_CUT } from './lookups';

/** Dash's box (plan #1899.5): what @ and / open, and what a question carries. */

describe('boxTrigger', () => {
  it('reads a slash and a word at the start as a command', () => {
    expect(boxTrigger('/', 1)).toEqual({ kind: 'command', query: '', start: 0, end: 1 });
    expect(boxTrigger('/to', 3)).toEqual({ kind: 'command', query: 'to', start: 0, end: 3 });
    expect(boxTrigger('and /to', 7)).toBeNull();
    expect(boxTrigger('/todo buy', 9)).toBeNull();
  });

  it('reads an @ and a few words of a name as a row', () => {
    expect(boxTrigger('What did I pay for @cat', 23)).toEqual({ kind: 'row', query: 'cat', start: 19, end: 23 });
    expect(boxTrigger('@', 1)).toEqual({ kind: 'row', query: '', start: 0, end: 1 });
    expect(boxTrigger('me@example.com', 14)).toBeNull();
  });

  it('replaces exactly what was typed for it', () => {
    const at = boxTrigger('Look at @cat now', 12)!;
    expect(replaceTrigger('Look at @cat now', at, '')).toEqual({ draft: 'Look at  now', caret: 8 });
    const slash = boxTrigger('/to', 3)!;
    expect(replaceTrigger('/to', slash, 'Add a todo: ')).toEqual({ draft: 'Add a todo: ', caret: 12 });
  });
});

describe('the commands', () => {
  it('each name a write tool Ask offers', () => {
    const offered = new Set(ASK_VOICE.tools.filter((t) => t.kind === 'write').map((t) => t.name));
    for (const command of BOX_COMMANDS) expect(offered.has(command.tool), command.name).toBe(true);
  });

  it('match by name or by what they do, and leave out switched-off workspaces', () => {
    expect(commandsFor('tod').map((c) => c.name)).toEqual(['todo']);
    expect(commandsFor('reading').map((c) => c.name)).toEqual(['read']);
    expect(commandsFor('', ['todo']).map((c) => c.name)).toEqual(['todo', 'event']);
  });
});

describe('what a question carries', () => {
  const row = { kind: 'order', id: 'o1', title: 'Catan lot, eBay', href: '/shopping/orders/o1' };

  it('keeps well formed rows once each, up to the most', () => {
    const many = Array.from({ length: MAX_MENTIONS + 3 }, (_, i) => ({ ...row, id: `o${i}` }));
    expect(parseAskMentions([row, row])).toEqual([row]);
    expect(parseAskMentions(many)).toHaveLength(MAX_MENTIONS);
  });

  it('leaves out a row of an unknown kind or a link to another site', () => {
    expect(parseAskMentions([{ ...row, kind: 'nope' }, { ...row, href: '//evil.example' }, { ...row, href: 'https://x' }])).toEqual([]);
    expect(parseAskMentions('o1')).toEqual([]);
  });

  it('takes a workspace as the scope, and anything else as every workspace', () => {
    expect(parseAskInput('q', null, null, [], undefined, null, [row], 'learn')).toMatchObject({
      ok: true,
      input: { mentions: [row], scope: 'learn' },
    });
    expect(parseAskInput('q', null, null, [], undefined, null, undefined, 'nowhere')).toMatchObject({
      ok: true,
      input: { mentions: [], scope: null },
    });
  });
});

describe('a question kept to one workspace', () => {
  it('offers that workspace lookups and those that range over every one, and keeps the writes', () => {
    const tools = scopedVoice('learn').tools;
    const lookups = tools.filter((t) => t.kind === 'lookup').map((t) => t.name);
    expect(lookups).toContain('reading_list');
    expect(lookups).toContain('search');
    expect(lookups).not.toContain('todos');
    expect(lookups).not.toContain('search_mail');
    expect(lookups).not.toContain('read_dev_row');
    expect(tools.filter((t) => t.kind === 'write').length).toBe(ASK_VOICE.tools.filter((t) => t.kind === 'write').length);
    expect(scopedVoice(null)).toBe(ASK_VOICE);
  });

  it('lets Dev lookups through only in Dev', () => {
    expect(lookupInScope('read_dev_row', 'dev')).toBe(true);
    expect(lookupInScope('read_dev_row', 'goals')).toBe(false);
    expect(lookupInScope('goal_status', 'goals')).toBe(true);
  });
});

describe('the asked line', () => {
  it('is heard before the answer, so a stopped question can be found again', async () => {
    const asked = { conversation: { ref: 'r1', title: 'q' }, turns: [] };
    const body = new Blob([encodeStreamLine({ asked }), encodeStreamLine({ text: 'You' })]).stream();
    const heard: unknown[] = [];
    const result = await readAskStream(body, () => {}, () => {}, (wire) => heard.push(wire));
    expect(heard).toEqual([asked]);
    expect(result.error).toBe(STREAM_CUT);
  });
});

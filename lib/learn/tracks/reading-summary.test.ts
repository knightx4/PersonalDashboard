import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  describeReading,
  MAX_SUMMARY,
  summaryCutLine,
  summaryParagraphs,
  summarySource,
  UNREADABLE_ACTION,
  usableSummary,
} from './reading-summary';
import { UNREADABLE_MESSAGE } from '@/lib/learn/locate/reading-text';
import { SUMMARY_MODEL, summarizeReadingText } from './reading-summary-model';

describe('describeReading', () => {
  it('puts the title, the why and the text in tags', () => {
    const turn = describeReading({ title: 'Elasticity', why: 'The step you missed.', text: 'Body.' });
    expect(turn).toBe('Title: Elasticity\nWhy it is on their reading list: The step you missed.\n\n<reading>\nBody.\n</reading>');
  });

  it('leaves out an empty why', () => {
    expect(describeReading({ title: 'T', why: '  ', text: 'x' })).not.toContain('Why');
  });
});

describe('usableSummary', () => {
  it('takes off a heading and collapses blank lines', () => {
    expect(usableSummary('Summary:\n\nFirst paragraph of the summary.\n\n\n\nSecond one.')).toBe(
      'First paragraph of the summary.\n\nSecond one.',
    );
  });

  it('refuses an empty or near-empty reply', () => {
    expect(usableSummary('  ')).toBeNull();
    expect(usableSummary('Too short.')).toBeNull();
  });

  it('caps a runaway reply', () => {
    const text = usableSummary('word '.repeat(5_000))!;
    expect(text.length).toBeLessThanOrEqual(MAX_SUMMARY + 1);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('the lines above a summary', () => {
  it('names the site of a link', () => {
    expect(summarySource({ from: 'link', label: 'https://www.example.com/a/b' })).toEqual({
      text: 'From the page at',
      site: 'example.com',
    });
  });

  it('names pasted text and a file', () => {
    expect(summarySource({ from: 'given', label: 'Pasted' }).text).toBe('From the text you pasted.');
    expect(summarySource({ from: 'given', label: 'paper.pdf' })).toEqual({
      text: 'From the text you gave it: paper.pdf.',
      site: null,
    });
  });

  it('says when the reading was cut at 200,000 characters', () => {
    expect(summaryCutLine(false)).toBeNull();
    expect(summaryCutLine(true)).toContain('200,000');
  });

  it('links the end of the unreadable message', () => {
    expect(UNREADABLE_MESSAGE.endsWith(`${UNREADABLE_ACTION}.`)).toBe(true);
  });

  it('splits paragraphs on blank lines', () => {
    expect(summaryParagraphs('One.\n\nTwo.\n \nThree.')).toEqual(['One.', 'Two.', 'Three.']);
  });
});

describe('summarizeReadingText', () => {
  function fakeClient(reply: string | Error) {
    const create = vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return {
        content: [{ type: 'text', text: reply }],
        usage: { input_tokens: 1_000, output_tokens: 100 },
      };
    });
    return { create, client: { messages: { create } } as never };
  }

  it('returns the summary and reports what it spent', async () => {
    const { client, create } = fakeClient('The reading argues that demand responds to price.');
    const spent: unknown[] = [];
    const result = await summarizeReadingText({
      title: 'T',
      why: null,
      text: 'x',
      anthropicApiKey: 'k',
      client,
      onSpend: (report) => spent.push(report),
    });
    expect(result).toEqual({ ok: true, text: 'The reading argues that demand responds to price.' });
    expect(spent).toHaveLength(1);
    expect(create.mock.calls[0]).toBeDefined();
    expect((spent[0] as { model: string }).model).toBe(SUMMARY_MODEL);
  });

  it('fails without spending when the call throws', async () => {
    const { client } = fakeClient(new Error('overloaded'));
    const spent: unknown[] = [];
    const result = await summarizeReadingText({
      title: 'T',
      why: null,
      text: 'x',
      anthropicApiKey: 'k',
      client,
      onSpend: (report) => spent.push(report),
    });
    expect(result).toEqual({ ok: false, detail: 'overloaded' });
    expect(spent).toHaveLength(0);
  });
});

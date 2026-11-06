import { describe, expect, it } from 'vitest';
import { heldFixes, personAskHtml, personAskQuestion, shellQuote, type PersonAsk } from './ui-person-ask';

const fix = (breaks: string, problem: string) => ({ shot: 'laptop-light', where: 'the list', problem, breaks, change: 'Match it.' });

const ask: PersonAsk = {
  surface: 'chat-people',
  route: '/chat',
  round: 3,
  kinds: ['reference'],
  fixes: [fix('reference', 'The mockup puts the thread beside the list.'), fix('law 9', 'Two weights compete.')],
  shot: 'file:///w/.preview-shots/chat-people--laptop-light.png',
  reference: 'file:///w/docs/references/chat-people/chat-laptop.png',
  before: null,
};

describe('the question a held screen becomes (plan #2966.4)', () => {
  it('puts only the fixes the person settles to them', () => {
    expect(heldFixes(ask.fixes).map((f) => f.breaks)).toEqual(['reference']);
  });

  it('draws the shot as built beside the mockup, one option each', () => {
    const html = personAskHtml(ask);
    expect(html).toContain('<figure data-option="A"><figcaption>A. Keep it as built</figcaption><img src="file:///w/.preview-shots/chat-people--laptop-light.png"');
    expect(html).toContain('<figure data-option="B"><figcaption>B. Change it to match the mockup</figcaption>');
    expect(html).toContain('docs/references/chat-people/chat-laptop.png');
    expect(html).toContain('The mockup puts the thread beside the list.');
    expect(html).not.toContain('Two weights compete.');
  });

  it("shows main's shot for a regression with no mockup, and the findings alone for a done-when", () => {
    const regression = { ...ask, kinds: ['regression'], reference: null, before: 'file:///w/before.png' };
    expect(personAskHtml(regression)).toContain('B. Put back what it lost');
    expect(personAskHtml(regression)).toContain('file:///w/before.png');
    const doneWhen = { ...ask, kinds: ['done-when'], reference: null, fixes: [fix('done-when', 'No way to send.')] };
    const html = personAskHtml(doneWhen);
    expect(html).toContain('B. Change it to do what the step says');
    expect(html.match(/<img /g)).toHaveLength(1);
  });

  it('writes the decision as a question with lettered options and the page named', () => {
    const { title, detail } = personAskQuestion(ask);
    expect(title).toBe('Keep /chat as built, or change it to match the mockup?');
    const lines = detail.split('\n');
    expect(lines[0]).toContain('/chat (/preview?s=chat-people) departs from the mockup');
    expect(lines[1]).toMatch(/^A — Keep it as built\./);
    expect(lines[2]).toMatch(/^B — Change it to match the mockup\./);
    expect(lines[3]).toMatch(/^Recommend B/);
  });

  it('escapes what it writes into the page and the shell', () => {
    const html = personAskHtml({ ...ask, fixes: [fix('reference', '<b>bold</b> & "quoted"')] });
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

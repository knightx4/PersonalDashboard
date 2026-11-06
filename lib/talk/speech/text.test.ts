import { describe, expect, it } from 'vitest';
import { plainSpeech, prepareSpeech, SPEAK_CHAR_LIMIT, trimForSpeech, utf8Bytes } from './text';

describe('plainSpeech', () => {
  it('keeps a link’s words and drops its address', () => {
    expect(plainSpeech('See [the plan](https://example.com/plan?a=(1)) today.')).toBe('See the plan today.');
  });

  it('drops pictures, bare addresses, row refs and citation marks', () => {
    const reply =
      'Your run is on Sunday [1] ![map](https://x.y/m.png) at https://maps.example.com/run, ' +
      'filed as todo.tasks:3f2a1c4e-1b2c-4d5e-8f90-1234567890ab [^2] 【3】.';
    expect(plainSpeech(reply)).toBe('Your run is on Sunday at, filed as.');
  });

  it('drops code blocks and takes the marks off emphasis, headings and lists', () => {
    const reply = [
      '## Next steps',
      '',
      '- **Book** the _physio_',
      '- Run `5k` on ~~Saturday~~ Sunday',
      '',
      '```ts',
      'const secret = 1;',
      '```',
      '> Keep going',
    ].join('\n');
    expect(plainSpeech(reply)).toBe('Next steps\n\nBook the physio\nRun 5k on Saturday Sunday\n\nKeep going');
  });

  it('reads a table as its cells and drops the divider', () => {
    expect(plainSpeech('| Day | Run |\n|---|---|\n| Mon | 5k |')).toBe('Day, Run\nMon, 5k');
  });

  it('leaves underscores inside words alone', () => {
    expect(plainSpeech('The snake_case name stays.')).toBe('The snake_case name stays.');
  });

  it('drops HTML tags but keeps their words', () => {
    expect(plainSpeech('Hello <b>there</b><br/>friend')).toBe('Hello there friend');
  });
});

describe('trimForSpeech', () => {
  it('leaves a short reply as it is', () => {
    expect(trimForSpeech('Short.', 600)).toEqual({ text: 'Short.', trimmed: false });
  });

  it('cuts at the last sentence that fits', () => {
    const text = `${'a'.repeat(40)}. ${'b'.repeat(40)}. ${'c'.repeat(40)}.`;
    expect(trimForSpeech(text, 90)).toEqual({ text: `${'a'.repeat(40)}. ${'b'.repeat(40)}.`, trimmed: true });
  });

  it('cuts at a word with an ellipsis when no sentence ends late enough', () => {
    const out = trimForSpeech('one two three four five six seven eight nine ten', 20);
    expect(out).toEqual({ text: 'one two three four…', trimmed: true });
  });
});

describe('prepareSpeech', () => {
  it('turns list items into sentences', () => {
    expect(prepareSpeech('Today:\n- Run\n- Stretch').text).toBe('Today: Run. Stretch.');
  });

  it('never sends more than the limit, and counts bytes as UTF-8', () => {
    const long = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const out = prepareSpeech(long);
    expect(Array.from(out.text).length).toBeLessThanOrEqual(SPEAK_CHAR_LIMIT);
    expect(out.trimmed).toBe(true);
    expect(out.bytes).toBe(utf8Bytes(out.text));
    expect(utf8Bytes('café')).toBe(5);
  });

  it('has nothing to say for a reply of only code and links', () => {
    expect(prepareSpeech('```\ncode\n```\nhttps://example.com')).toEqual({ text: '', bytes: 0, trimmed: false });
  });
});

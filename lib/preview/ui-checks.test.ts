import { describe, expect, it } from 'vitest';
import {
  bucketPath,
  checkLine,
  checkRow,
  connectorSql,
  keptShotFile,
  parseOwner,
  parseVerdict,
  verdictFile,
} from './ui-checks';

const NOTE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const questions = {
  eye: { answer: "The story's headline, which is what the screen is for.", ok: true },
  competition: { answer: 'No: the source label is lighter than the headline.', ok: true },
  lines: { answer: "Yes: the dividers are the light border colour, under the text's weight.", ok: true },
};

const fixVerdict = JSON.stringify({
  surface: 'news-quick-story',
  round: 2,
  verdict: 'fix',
  fixes: [
    {
      shot: 'phone-light',
      where: 'the Next button',
      problem: "It's under the dock.",
      breaks: 'law 4',
      change: 'Lift it above the dock.',
    },
  ],
  earlier: [{ where: 'the header', done: 'yes' }],
  notes: "The story's image loads late.",
  questions,
});

describe('parseOwner', () => {
  it('reads a step number, with or without its hash', () => {
    expect(parseOwner('1533')).toEqual({ step: 1533, noteId: null });
    expect(parseOwner('#1533')).toEqual({ step: 1533, noteId: null });
  });

  it('reads a note id', () => {
    expect(parseOwner(NOTE.toUpperCase())).toEqual({ step: null, noteId: NOTE });
  });

  it('refuses anything else', () => {
    expect(() => parseOwner('0')).toThrow();
    expect(() => parseOwner('plan-12')).toThrow();
  });
});

describe('file names', () => {
  it('match the ones building.md and the notes skill give', () => {
    const step = parseOwner('1533');
    expect(verdictFile(step, 'vault-note', 1)).toBe('.preview-shots/checks/1533--vault-note--r1.json');
    expect(keptShotFile(step, 'vault-note', 1, 'phone-dark')).toBe(
      '.preview-shots/checks/1533--vault-note--r1--phone-dark.png',
    );
    expect(verdictFile(parseOwner(NOTE), 'vault-note', 3)).toBe(
      `.preview-shots/checks/${NOTE}--vault-note--r3.json`,
    );
  });

  it('put each shot under the account folder the read policy checks', () => {
    expect(bucketPath('user-1', parseOwner('1533'), 'vault-note', 2, 'laptop-light')).toBe(
      'user-1/1533/vault-note/r2/laptop-light.png',
    );
  });
});

describe('parseVerdict', () => {
  it('keeps the critic block as it came', () => {
    const verdict = parseVerdict(fixVerdict, 'news-quick-story', 2);
    expect(verdict.verdict).toBe('fix');
    expect(verdict.fixes[0].problem).toBe("It's under the dock.");
    expect(verdict.earlier).toEqual([{ where: 'the header', done: 'yes' }]);
    expect(checkLine(verdict)).toBe('UI-check: news-quick-story round 2 fix (1 fix)');
  });

  it('takes an earlier fix marked done as true, the way the critic is told to write it', () => {
    const raw = JSON.stringify({
      surface: 'home-week',
      round: 2,
      verdict: 'pass',
      fixes: [],
      earlier: [{ where: 'the line under the title', done: true }],
      notes: null,
      questions,
    });
    expect(parseVerdict(raw, 'home-week', 2).earlier).toEqual([
      { where: 'the line under the title', done: true },
    ]);
  });

  it('refuses a verdict saved under another surface or round', () => {
    expect(() => parseVerdict(fixVerdict, 'vault-note', 2)).toThrow(/surface/);
    expect(() => parseVerdict(fixVerdict, 'news-quick-story', 1)).toThrow(/round/);
  });

  it('refuses a verdict that is neither pass nor fix, or a fix missing a field', () => {
    const base = JSON.parse(fixVerdict);
    expect(() => parseVerdict(JSON.stringify({ ...base, verdict: 'ok' }), 'news-quick-story', 2)).toThrow();
    const noChange = { ...base, fixes: [{ ...base.fixes[0], change: undefined }] };
    expect(() => parseVerdict(JSON.stringify(noChange), 'news-quick-story', 2)).toThrow(/change/);
    expect(() => parseVerdict('Looks fine to me.', 'news-quick-story', 2)).toThrow(/json/);
  });

  it('reads a pass with no fixes', () => {
    const pass = parseVerdict(
      JSON.stringify({ surface: 'vault-note', round: 1, verdict: 'pass', fixes: [], earlier: [], notes: '', questions }),
      'vault-note',
      1,
    );
    expect(checkLine(pass)).toBe('UI-check: vault-note round 1 pass (0 fixes)');
  });
});

describe('the three questions', () => {
  const base = JSON.parse(fixVerdict);

  it('keeps the three answers as the critic wrote them, and stores them with the round', () => {
    const verdict = parseVerdict(fixVerdict, 'news-quick-story', 2);
    expect(verdict.questions).toEqual(questions);
    expect(checkRow(parseOwner('1892'), verdict, [], null).questions).toEqual(questions);
  });

  it('refuses a verdict with no questions, or with one of the three left out or unanswered', () => {
    const none = { ...base, questions: undefined };
    expect(() => parseVerdict(JSON.stringify(none), 'news-quick-story', 2)).toThrow(/questions/);
    for (const key of ['eye', 'competition', 'lines']) {
      const missing = { ...base, questions: { ...questions, [key]: undefined } };
      expect(() => parseVerdict(JSON.stringify(missing), 'news-quick-story', 2)).toThrow(key);
      const empty = { ...base, questions: { ...questions, [key]: { answer: ' ', ok: true } } };
      expect(() => parseVerdict(JSON.stringify(empty), 'news-quick-story', 2)).toThrow(/empty/);
      const noOk = { ...base, questions: { ...questions, [key]: { answer: 'Yes.' } } };
      expect(() => parseVerdict(JSON.stringify(noOk), 'news-quick-story', 2)).toThrow(/ok/);
    }
  });

  it('refuses a pass whose first answer says the eye has nowhere clear to go, and takes it as a fix', () => {
    const unclear = {
      ...questions,
      eye: { answer: 'Nowhere first: the heading, the filters and the chart weigh the same.', ok: false },
    };
    const pass = { ...base, verdict: 'pass', fixes: [], questions: unclear };
    expect(() => parseVerdict(JSON.stringify(pass), 'news-quick-story', 2)).toThrow(/fix/);
    const fix = { ...base, questions: unclear };
    expect(parseVerdict(JSON.stringify(fix), 'news-quick-story', 2).questions.eye.ok).toBe(false);
  });

  it('lets a pass stand when only the second or third answer is not ok', () => {
    const pass = {
      ...base,
      verdict: 'pass',
      fixes: [],
      questions: { ...questions, lines: { answer: 'No: the card outline is as dark as the text.', ok: false } },
    };
    expect(parseVerdict(JSON.stringify(pass), 'news-quick-story', 2).verdict).toBe('pass');
  });
});

describe('connectorSql', () => {
  const verdict = parseVerdict(fixVerdict, 'news-quick-story', 2);

  it('carries no apostrophe from the critic text, and decodes back to it', () => {
    const sql = connectorSql(checkRow(parseOwner('1533'), verdict, [], null));
    expect(sql).not.toContain("It's");
    expect(sql).toContain('where number = 1533');
    expect(sql).toContain('on conflict (user_id, step, surface, round)');
    const encodedFixes = sql.match(/decode\('([^']+)'/)![1];
    expect(JSON.parse(Buffer.from(encodedFixes, 'base64').toString('utf8'))).toEqual(verdict.fixes);
  });

  it('writes the three answers into the questions column, and replaces them on a second record', () => {
    const sql = connectorSql(checkRow(parseOwner('1533'), verdict, [], null));
    expect(sql).toMatch(/notes, questions, shots/);
    expect(sql).toContain('questions = excluded.questions');
    const decoded = [...sql.matchAll(/decode\('([^']+)'/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8'),
    );
    expect(decoded.map((d) => (d.startsWith('{') ? JSON.parse(d) : d))).toContainEqual(questions);
  });

  it('keys a note round by the note and its owner', () => {
    const sql = connectorSql(checkRow(parseOwner(NOTE), verdict, [], 'abc1234'));
    expect(sql).toContain(`from feedback_items where id = '${NOTE}'`);
    expect(sql).toContain('on conflict (user_id, note_id, surface, round)');
    expect(sql).toContain("'abc1234'");
  });
});

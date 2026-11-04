import { describe, expect, it } from 'vitest';
import { mockupRefusal, mockupStoragePath, optionLettersIn } from './mockups';

const base = { kind: 'decision', title: 'Which layout for the People chats?', detail: null, mockup: null, noMockupReason: null };

describe('mockupRefusal', () => {
  it('turns away a decision about a screen with no mockup', () => {
    expect(mockupRefusal(base)).toMatch(/--mockup/);
  });
  it('reads the detail as well as the title', () => {
    expect(mockupRefusal({ ...base, title: 'Which shape?', detail: 'A — a pane on the left' })).not.toBeNull();
  });
  it('lets one through with a mockup or a reason', () => {
    expect(mockupRefusal({ ...base, mockup: 'a.html' })).toBeNull();
    expect(mockupRefusal({ ...base, noMockupReason: 'it is about a file format' })).toBeNull();
  });
  it('leaves a question that is not about a screen, and any build step, alone', () => {
    expect(mockupRefusal({ ...base, title: 'Which export format?' })).toBeNull();
    expect(mockupRefusal({ ...base, kind: 'build' })).toBeNull();
  });
});

describe('mockup paths and letters', () => {
  it('keeps pictures under the user and the step number', () => {
    expect(mockupStoragePath('u1', 2754, 'A', 390)).toBe('u1/2754/A-390.png');
    expect(mockupStoragePath('u1', 12, null, 1280)).toBe('u1/12/whole-1280.png');
  });
  it('lists the marked options once, in order', () => {
    expect(optionLettersIn('<div data-option="B"></div><p data-option=\'A\'></p><i data-option="B">')).toEqual(['B', 'A']);
    expect(optionLettersIn('<p>none</p>')).toEqual([]);
  });
});

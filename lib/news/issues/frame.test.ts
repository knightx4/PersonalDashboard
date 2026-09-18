import { describe, expect, it } from 'vitest';
import { frameMessage, issueDocument } from './frame';

const FRAME = { name: 'the frame window' };
const height = (value: unknown) => ({ source: 'news-frame', kind: 'height', height: value });
const open = (href: unknown) => ({ source: 'news-frame', kind: 'open', href });

describe('issueDocument', () => {
  it('carries the newsletter, the width rules and the lines that measure it', () => {
    const doc = issueDocument('<h1>This week</h1>');
    expect(doc).toContain('<h1>This week</h1>');
    expect(doc).toContain('width=device-width');
    expect(doc).toContain('max-width: 100% !important');
    expect(doc).toContain('parent.postMessage');
    expect(doc).toContain("kind: 'height'");
    expect(doc).toContain("kind: 'open'");
  });

  it('measures again when a late picture lands', () => {
    const doc = issueDocument('');
    expect(doc).toContain("document.addEventListener('load', measure, true)");
    expect(doc).toContain('ResizeObserver');
  });
});

describe('frameMessage', () => {
  it('reads a height from the frame', () => {
    expect(frameMessage(height(2480), FRAME, FRAME)).toEqual({ kind: 'height', height: 2480 });
  });

  it('rounds a fractional height up, so nothing is left cut off', () => {
    expect(frameMessage(height(2480.2), FRAME, FRAME)).toEqual({ kind: 'height', height: 2481 });
  });

  it('ignores a height that is not a usable number', () => {
    for (const value of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, 40_001, '900', null]) {
      expect(frameMessage(height(value), FRAME, FRAME)).toBeNull();
    }
  });

  it('reads a link the frame was asked to open', () => {
    expect(frameMessage(open('https://example.com/story'), FRAME, FRAME)).toEqual({
      kind: 'open',
      href: 'https://example.com/story',
    });
    expect(frameMessage(open('mailto:someone@example.com'), FRAME, FRAME)).toEqual({
      kind: 'open',
      href: 'mailto:someone@example.com',
    });
  });

  it('ignores an address that is not one a tab should be opened on', () => {
    for (const href of ['javascript:steal()', 'data:text/html,<script>', '/relative', '', 7]) {
      expect(frameMessage(open(href), FRAME, FRAME)).toBeNull();
    }
  });

  it('ignores a message from any window but the frame', () => {
    const somewhereElse = { name: 'another window' };
    expect(frameMessage(height(900), somewhereElse, FRAME)).toBeNull();
    expect(frameMessage(open('https://example.com'), somewhereElse, FRAME)).toBeNull();
  });

  it('ignores everything until the frame has a window of its own', () => {
    expect(frameMessage(height(900), null, null)).toBeNull();
  });

  it('ignores anything that is not one of the two messages', () => {
    expect(frameMessage({ source: 'news-frame', kind: 'navigate' }, FRAME, FRAME)).toBeNull();
    expect(frameMessage({ kind: 'height', height: 900 }, FRAME, FRAME)).toBeNull();
    expect(
      frameMessage({ source: 'somebody-else', kind: 'height', height: 900 }, FRAME, FRAME),
    ).toBeNull();
    expect(frameMessage('height: 900', FRAME, FRAME)).toBeNull();
    expect(frameMessage(null, FRAME, FRAME)).toBeNull();
  });
});

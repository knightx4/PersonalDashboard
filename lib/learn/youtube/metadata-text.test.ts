import { describe, expect, it } from 'vitest';
import { METADATA_DESCRIPTION_CHARS, metadataText } from '@/lib/learn/youtube/metadata-text';

describe('metadataText', () => {
  it('keeps the title and the lines that say what the video is about', () => {
    const text = metadataText(
      'Why buffer states start wars',
      [
        'Small states between great powers are meant to keep the peace.',
        '',
        'Patreon: https://patreon.com/example',
        'Twitter: https://twitter.com/example',
        '#geopolitics #history',
        '@example',
      ].join('\n'),
    );
    expect(text).toBe(
      'Why buffer states start wars\n\nSmall states between great powers are meant to keep the peace.',
    );
  });

  it('drops a label left with nothing once its link is gone', () => {
    expect(metadataText('Title', 'Twitter:\nThe point of the video.')).toBe('Title\n\nThe point of the video.');
  });

  it('cuts a long description at a line, within the limit', () => {
    const line = 'x'.repeat(300);
    const text = metadataText('T', [line, line, line, line].join('\n'));
    expect(text.length).toBeLessThanOrEqual('T\n\n'.length + METADATA_DESCRIPTION_CHARS);
    expect(text).toBe(`T\n\n${line}\n${line}`);
  });

  it('cuts a single overlong line rather than dropping the description', () => {
    const text = metadataText('T', 'y'.repeat(2000));
    expect(text).toBe(`T\n\n${'y'.repeat(METADATA_DESCRIPTION_CHARS)}`);
  });

  it('is the title alone when there is no description', () => {
    expect(metadataText('  Eigenvalues  ', null)).toBe('Eigenvalues');
  });

  it('is never empty', () => {
    expect(metadataText('   ', '')).toBe('Untitled video');
  });
});

import { describe, expect, it } from 'vitest';
import {
  clockTime,
  durationLabel,
  embedUrl,
  playerTime,
  sectionProgress,
  watchAt,
  youtubeVideoId,
} from '@/lib/learn/youtube/format';

describe('clockTime', () => {
  it('writes minutes and seconds, and hours only when there are some', () => {
    expect(clockTime(0)).toBe('0:00');
    expect(clockTime(75)).toBe('1:15');
    expect(clockTime(3725)).toBe('1:02:05');
    expect(clockTime(8.9)).toBe('0:08');
  });
});

describe('durationLabel', () => {
  it('says nothing for a length YouTube did not give', () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(2340)).toBe('39:00');
  });
});

describe('embedUrl', () => {
  it('plays exactly the span asked for', () => {
    expect(embedUrl('ZK3O402wf1c', 754, 1012.4)).toBe(
      'https://www.youtube-nocookie.com/embed/ZK3O402wf1c?start=754&end=1013&rel=0',
    );
  });

  it('leaves out a start of zero and an end before the start', () => {
    expect(embedUrl('ZK3O402wf1c', 0)).toBe('https://www.youtube-nocookie.com/embed/ZK3O402wf1c?rel=0');
    expect(embedUrl('ZK3O402wf1c', 300, 200)).toBe(
      'https://www.youtube-nocookie.com/embed/ZK3O402wf1c?start=300&rel=0',
    );
  });
});

describe('watchAt', () => {
  it('opens the video at a second', () => {
    expect(watchAt('ZK3O402wf1c', 754.6)).toBe('https://www.youtube.com/watch?v=ZK3O402wf1c&t=754s');
  });
});

describe('youtubeVideoId', () => {
  it('reads the id from every shape of video link', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=TSdXJw83kyA')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=TSdXJw83kyA&t=1468s')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://m.youtube.com/watch?v=TSdXJw83kyA')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://youtu.be/TSdXJw83kyA?t=90')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://www.youtube-nocookie.com/embed/TSdXJw83kyA?start=5')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://www.youtube.com/shorts/TSdXJw83kyA')).toBe('TSdXJw83kyA');
  });

  it('gives null for anything that is not one video', () => {
    expect(youtubeVideoId(null)).toBeNull();
    expect(youtubeVideoId('')).toBeNull();
    expect(youtubeVideoId('not a url')).toBeNull();
    expect(youtubeVideoId('https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/@mitocw')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/playlist?list=PL49CF3715CB9EF31D')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeVideoId('https://notyoutube.com/watch?v=TSdXJw83kyA')).toBeNull();
  });
});

describe('sectionProgress', () => {
  it('is how far through the section the player is, held to the section', () => {
    expect(sectionProgress(724, 845, 700)).toEqual({ watched: 0, length: 121, done: false });
    expect(sectionProgress(724, 845, 784)).toEqual({ watched: 60, length: 121, done: false });
    expect(sectionProgress(724, 845, 900)).toEqual({ watched: 121, length: 121, done: true });
  });

  it('counts the end as reached half a second short of it, where the player stops', () => {
    expect(sectionProgress(724, 845, 844.6)?.done).toBe(true);
    expect(sectionProgress(724, 845, 844)?.done).toBe(false);
  });

  it('is nothing for a clip without a closed span', () => {
    expect(sectionProgress(null, null, 10)).toBeNull();
    expect(sectionProgress(724, null, 800)).toBeNull();
    expect(sectionProgress(845, 724, 800)).toBeNull();
  });
});

describe('playerTime', () => {
  it('reads currentTime from an infoDelivery message', () => {
    expect(playerTime(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 731.2 } }))).toBe(731.2);
  });

  it('is null for every other message', () => {
    expect(playerTime(JSON.stringify({ event: 'infoDelivery', info: { volume: 100 } }))).toBeNull();
    expect(playerTime(JSON.stringify({ event: 'onReady', info: null }))).toBeNull();
    expect(playerTime('not json')).toBeNull();
    expect(playerTime({ event: 'infoDelivery', info: { currentTime: 1 } })).toBeNull();
    expect(playerTime(JSON.stringify(null))).toBeNull();
  });
});

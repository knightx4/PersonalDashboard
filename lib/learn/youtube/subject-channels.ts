import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { JudgeChannelsResult, Sample } from './channel-judge';
import type { FindChannelsResult } from './channel-search';

/**
 * The channels found for a subject, as its page shows them (plan #1199,
 * under #1185).
 *
 * Each learn.subject_channels row is in one of five states, read from its
 * verdict and what Learn did about it (#1200 settled that Learn follows the
 * good ones itself, with an Unfollow beside each):
 *
 * - judging: no verdict yet, because its three videos are still being picked
 *   or their transcripts have not arrived. The scheduled run finishes it.
 * - retrying: judged worth following, but YouTube would not add it to the
 *   library yet. The next press or scheduled run tries again.
 * - following: in your YouTube library, with an Unfollow button.
 * - unfollowed: you took it back out; it is not suggested again.
 * - passed: judged not worth following.
 *
 * `channelsPressLines` turns one Find channels press into the lines shown
 * beside the button, including what stopped it and how far it got.
 */

export type ChannelState = 'judging' | 'retrying' | 'following' | 'unfollowed' | 'passed';

export type SubjectChannelView = {
  id: string;
  title: string;
  handle: string | null;
  foundWhy: string | null;
  verdict: 'follow' | 'pass' | null;
  /** The reason for the verdict, written about your level in the subject. */
  why: string | null;
  state: ChannelState;
  /** The judged videos, in the order they were picked. */
  samples: Sample[];
  /** How many videos were picked to judge it by; null until they are. */
  picked: number | null;
};

type ChannelRow = {
  id: string;
  title: string;
  handle: string | null;
  found_why: string | null;
  verdict: 'follow' | 'pass' | null;
  why: string | null;
  samples: Sample[] | null;
  picks: unknown[] | null;
  decided: 'followed' | 'passed' | 'unfollowed' | null;
};

export function channelState(row: Pick<ChannelRow, 'verdict' | 'decided'>): ChannelState {
  if (row.decided === 'followed') return 'following';
  if (row.decided === 'unfollowed') return 'unfollowed';
  if (row.decided === 'passed' || row.verdict === 'pass') return 'passed';
  if (row.verdict === 'follow') return 'retrying';
  return 'judging';
}

export function toView(row: ChannelRow): SubjectChannelView {
  return {
    id: row.id,
    title: row.title,
    handle: row.handle,
    foundWhy: row.found_why,
    verdict: row.verdict,
    why: row.why,
    state: channelState(row),
    samples: row.samples ?? [],
    picked: row.picks ? row.picks.length : null,
  };
}

export type SubjectChannels = {
  channels: SubjectChannelView[];
  /** Sampled videos that went into your Videos section, by YouTube video id. */
  kept: Set<string>;
};

/** The channels found for one subject, oldest first, and which samples you kept. */
export async function loadSubjectChannels(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<SubjectChannels> {
  const [rows, kept] = await Promise.all([
    learn
      .from('subject_channels')
      .select('id, title, handle, found_why, verdict, why, samples, picks, decided')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .order('created_at'),
    learn
      .from('watch_list')
      .select('video_id')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .eq('came_from', 'channel search'),
  ]);
  if (rows.error) throw new Error(`Reading the channels found failed: ${rows.error.message}`);
  if (kept.error) throw new Error(`Reading the videos kept from them failed: ${kept.error.message}`);
  return {
    channels: ((rows.data ?? []) as ChannelRow[]).map(toView),
    kept: new Set(((kept.data ?? []) as { video_id: string }[]).map((row) => row.video_id)),
  };
}

// ---------------------------------------------------------------------------
// What one press says.
// ---------------------------------------------------------------------------

export type ChannelsPressState = {
  /** What the press did, one line each. */
  lines?: string[];
  /** What stopped it, when something did. */
  error?: string;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The search failures after which the channels already stored are still worth judging. */
export function judgeAfterSearch(search: FindChannelsResult): boolean {
  return search.ok || (search.reason !== 'no-anthropic-key' && search.reason !== 'no-subject');
}

/**
 * The lines one press shows. `judge` is null when the search stopped before
 * judging was worth starting.
 */
export function channelsPressLines(search: FindChannelsResult, judge: JudgeChannelsResult | null): ChannelsPressState {
  const lines: string[] = [];
  const stops: string[] = [];

  if (search.ok) {
    lines.push(`Found ${plural(search.added.length, 'new channel', 'new channels')}.`);
    if (search.unresolved.length > 0) {
      lines.push(
        `${plural(search.unresolved.length, 'recommended channel', 'recommended channels')} could not be found on YouTube: ${search.unresolved.join(', ')}.`,
      );
    }
  } else if (search.reason === 'nothing-new') {
    lines.push(`No new channels this time. ${search.detail}`);
  } else {
    const got = search.added.length > 0 ? ` ${plural(search.added.length, 'channel was', 'channels were')} stored before it stopped.` : '';
    stops.push(`The search stopped: ${search.detail}${got}`);
  }

  if (judge && !judge.ok) {
    stops.push(`Judging did not start: ${judge.detail}`);
  } else if (judge) {
    const done: string[] = [];
    if (judge.judged.length > 0) {
      const follow = judge.judged.filter((channel) => channel.verdict === 'follow').length;
      done.push(`${plural(judge.judged.length, 'channel', 'channels')} judged, ${follow} worth following`);
    }
    if (judge.settled && judge.settled.followed.length > 0) {
      done.push(`${plural(judge.settled.followed.length, 'channel', 'channels')} added to your YouTube library`);
    }
    if (judge.kept > 0) done.push(`${plural(judge.kept, 'video', 'videos')} added to your Videos`);
    if (done.length > 0) lines.push(`${done.join(', ')}.`);
    if (judge.waiting > 0) {
      lines.push(
        `${plural(judge.waiting, 'channel is', 'channels are')} still waiting on transcripts. The scheduled run finishes judging them.`,
      );
    }
    if (judge.settled && judge.settled.failed.length > 0) {
      lines.push(
        `YouTube would not add ${judge.settled.failed.map((channel) => channel.title).join(', ')} to your library yet. It is tried again on the next run.`,
      );
    }
    if (judge.failed > 0) {
      lines.push(`${plural(judge.failed, 'judging call', 'judging calls')} failed and will be tried again on the next run.`);
    }
    const credits = judge.transcripts?.stopped;
    if (credits && (credits.reason === 'budget' || credits.reason === 'account')) {
      stops.push(`Transcripts stopped: ${credits.detail}. The channels waiting on them are judged once they arrive.`);
    }
    if (judge.stopped) stops.push(`Judging stopped: ${judge.stopped}`);
  }

  return { lines, ...(stops.length > 0 ? { error: stops.join(' ') } : {}) };
}

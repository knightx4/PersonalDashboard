'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/dev/owner';
import {
  addAndListChannel,
  playlistVideoIds,
  relistChannel,
  removeChannel,
  setChannelAutoTranscribe,
  transcribeNow,
  type TranscribeReport,
} from '@/inngest/learn/youtube-library';
import type { ListChannelResult } from '@/lib/learn/youtube/library';

/**
 * The YouTube library's buttons.
 *
 * Every one of them is the owner's alone: listing spends the owner's YouTube
 * quota and transcribing spends the owner's TranscriptAPI credits. The check
 * is the first line of each, before anything else is read.
 *
 * Each returns one line to show beside the button, because a press that took
 * a minute and changed nothing visible needs to say what it did.
 */

export type PressState = { message?: string; error?: string };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function failed(error: unknown): PressState {
  if (error instanceof Error && error.message === 'unauthenticated') return { error: 'Sign in again.' };
  if (error instanceof Error && error.name === 'NotTheOwnerError') {
    return { error: 'Only the owner of this app can change the YouTube library.' };
  }
  return { error: error instanceof Error ? error.message : 'That did not work.' };
}

function listingLine(result: ListChannelResult): string {
  const parts = [
    result.newVideos > 0 ? `${plural(result.newVideos, 'new video', 'new videos')} stored` : 'no new videos',
  ];
  if (result.playlistsWalked > 0) parts.push(`${plural(result.playlistsWalked, 'playlist', 'playlists')} read`);
  if (result.playlistsSkipped > 0) parts.push(`${result.playlistsSkipped} unchanged`);
  if (result.queued > 0) parts.push(`${plural(result.queued, 'transcript', 'transcripts')} queued`);
  let line = parts.join(', ') + '.';
  if (result.playlistsNotReached > 0) {
    line += ` ${plural(result.playlistsNotReached, 'playlist was', 'playlists were')} not reached in time; the next run reads them.`;
  }
  return line;
}

// latency: pending
export async function addChannelAction(_prev: PressState, formData: FormData): Promise<PressState> {
  try {
    await requireOwner();
    const raw = String(formData.get('channel') ?? '');
    const report = await addAndListChannel(raw);
    if (!report.ok) return { error: report.error };
    revalidatePath('/learn/youtube');
    const lead = report.created ? `${report.name} added` : `${report.name} is already followed`;
    const listing = listingLine(report.listing);
    return report.listing.error
      ? { error: `${lead}; ${listing} YouTube refused part of the listing: ${report.listing.error}` }
      : { message: `${lead}: ${listing}` };
  } catch (error) {
    return failed(error);
  }
}

// latency: pending
export async function relistChannelAction(_prev: PressState, formData: FormData): Promise<PressState> {
  try {
    await requireOwner();
    const result = await relistChannel(String(formData.get('providerId') ?? ''));
    if (!result) return { error: 'That channel is not followed any more.' };
    revalidatePath('/learn/youtube', 'layout');
    const line = listingLine(result);
    return result.error ? { error: `${line} YouTube refused part of it: ${result.error}` } : { message: line };
  } catch (error) {
    return failed(error);
  }
}

// latency: pending -- should be optimistic: a toggle that waits for the round trip
export async function setAutoTranscribeAction(formData: FormData): Promise<void> {
  await requireOwner();
  await setChannelAutoTranscribe(String(formData.get('providerId') ?? ''), formData.get('on') === 'true');
  revalidatePath('/learn/youtube', 'layout');
}

// latency: pending
export async function removeChannelAction(formData: FormData): Promise<void> {
  await requireOwner();
  await removeChannel(String(formData.get('providerId') ?? ''));
  revalidatePath('/learn/youtube', 'layout');
}

function transcribeLine(report: TranscribeReport): PressState {
  const { transcripts, queued, embedding } = report;
  const parts: string[] = [];
  if (transcripts.fetched > 0) parts.push(`${plural(transcripts.fetched, 'transcript', 'transcripts')} fetched`);
  if (transcripts.cached > 0) parts.push(`${transcripts.cached} already stored`);
  if (transcripts.none > 0) parts.push(`${transcripts.none} with no captions`);
  if (transcripts.failed > 0) parts.push(`${transcripts.failed} failed and will be retried`);
  parts.push(plural(transcripts.credits, 'credit', 'credits') + ' spent');
  if (queued > 0) parts.push(`${queued} left queued for the scheduled run`);
  if (embedding && embedding.embedded > 0) parts.push(`${plural(embedding.embedded, 'clip', 'clips')} embedded`);
  const line = parts.join(', ') + '.';

  if (transcripts.stopped?.reason === 'account' || transcripts.stopped?.reason === 'budget') {
    return { error: `${line} Stopped: ${transcripts.stopped.detail}.` };
  }
  if (embedding?.stopped && embedding.stopped.reason !== 'time') {
    return { error: `${line} Embedding stopped: ${embedding.stopped.detail}.` };
  }
  return { message: line };
}

// latency: pending
export async function transcribeVideoAction(_prev: PressState, formData: FormData): Promise<PressState> {
  try {
    await requireOwner();
    const report = await transcribeNow([String(formData.get('videoId') ?? '')], 'press');
    revalidatePath('/learn/youtube', 'layout');
    return transcribeLine(report);
  } catch (error) {
    return failed(error);
  }
}

// latency: pending
export async function transcribePlaylistAction(_prev: PressState, formData: FormData): Promise<PressState> {
  try {
    await requireOwner();
    const videoIds = await playlistVideoIds(String(formData.get('courseItemId') ?? ''));
    if (videoIds.length === 0) return { error: 'That playlist has no videos stored.' };
    const report = await transcribeNow(videoIds, 'course');
    revalidatePath('/learn/youtube', 'layout');
    return transcribeLine(report);
  } catch (error) {
    return failed(error);
  }
}

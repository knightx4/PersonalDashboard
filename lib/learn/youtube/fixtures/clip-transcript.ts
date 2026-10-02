import type { TranscriptCue } from '@/lib/learn/catalogue/segment';

/**
 * A stored transcript in the shape transcripts.ts decodes, for the clip tests
 * (plan #1398): a short explainer on working capital with the parts a cutter
 * has to leave out. An intro, a sponsor read, two points that each stand
 * alone, a passage that leans on the one before it, and a sign-off. Captions
 * arrive as fragments of a few seconds, as YouTube's do, some ending mid
 * sentence.
 */
const lines: [number, number, string][] = [
  [0, 3.2, "Hey everyone, welcome back to the channel."],
  [3.2, 7.5, "Today we're talking about working capital, but first,"],
  [7.5, 11.8, "this video is sponsored by LedgerPro. LedgerPro makes bookkeeping"],
  [11.8, 16.4, "painless for small teams. Use code CAPITAL for twenty percent off."],
  [16.4, 21, "Okay, let's get into it."],
  [21, 25.6, "Working capital is the cash a business has tied up in running"],
  [25.6, 30.1, "day to day: what customers owe you, plus inventory, minus what"],
  [30.1, 34.4, "you owe your suppliers."],
  [34.4, 39.2, "A company can be profitable on paper and still run out of cash"],
  [39.2, 44, "if its customers pay in ninety days and its suppliers want paying"],
  [44, 47.9, "in thirty."],
  [47.9, 52.6, "That gap has to be funded from somewhere, usually the bank or"],
  [52.6, 56.8, "the founders, which is why fast-growing firms often feel poorer"],
  [56.8, 60.5, "the faster they grow."],
  [60.5, 65.2, "So that's why the number matters."],
  [65.2, 70, "Now, the cash conversion cycle measures how many days a dollar"],
  [70, 74.6, "spends inside the business before it comes back as cash."],
  [74.6, 79.3, "You add days of inventory to days of receivables, then subtract"],
  [79.3, 83.1, "days of payables."],
  [83.1, 88, "If you hold stock for forty days, collect in fifty, and pay in"],
  [88, 92.4, "thirty, your cycle is sixty days."],
  [92.4, 97.5, "Every day you cut from it is cash you no longer have to borrow."],
  [97.5, 102, "And as we just saw, that's the same gap from before."],
  [102, 106.3, "Which brings it back to the earlier example."],
  [106.3, 110.8, "That's it for today. If this helped, hit subscribe"],
  [110.8, 114, "and I'll see you in the next one."],
];

export const CLIP_TRANSCRIPT: TranscriptCue[] = lines.map(([startSeconds, endSeconds, text]) => ({ startSeconds, endSeconds, text }));

import type { AlsoIn } from '@/lib/news/quick/next';

/**
 * The pure half of loadElsewhere (elsewhere.ts): each of this newsletter's
 * stories to the other newsletters in its group, one entry per sender, newest
 * first. The newsletter's own sender is never named, and neither is an issue
 * that could not be read.
 */
export function elsewhereFrom(input: {
  ownSenderId: string | null;
  own: readonly { storyIndex: number; groupId: string }[];
  others: readonly { issueId: string; groupId: string }[];
  issues: readonly { id: string; senderId: string; receivedAt: string; from: string }[];
}): Record<number, AlsoIn[]> {
  const byId = new Map(input.issues.map((issue) => [issue.id, issue]));
  const result: Record<number, AlsoIn[]> = {};
  for (const { storyIndex, groupId } of input.own) {
    const found = input.others
      .filter((row) => row.groupId === groupId)
      .flatMap((row) => {
        const issue = byId.get(row.issueId);
        return issue && issue.senderId !== input.ownSenderId ? [issue] : [];
      })
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const list: AlsoIn[] = [];
    const senders = new Set<string>();
    for (const issue of found) {
      if (senders.has(issue.senderId)) continue;
      senders.add(issue.senderId);
      list.push({ issueId: issue.id, from: issue.from });
    }
    if (list.length) result[storyIndex] = list;
  }
  return result;
}

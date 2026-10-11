'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { InboxOverview, inboxAnchor, type InboxCell } from '@/components/inbox/overview';
import { Card } from '@/components/ui/card';
import { Group, SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import type { GoalInboxGroup } from '@/lib/goals/inbox';
import type { LaterLaneItem } from '@/lib/goals/lanes';
import type { TodayItem } from '@/lib/goals/today';
import { DashRow, LaterRow } from '../goal-lanes';
import { TodayRow } from '../today-list';

const keyOf = (item: TodayItem) => `${item.kind}:${item.id}`;

/**
 * Everything on you in Goals, on a tab of its own: the overview of counts,
 * then one section per kind of work, then what you set aside, folded shut.
 *
 * The rows are the Home's own (TodayRow, DashRow, LaterRow), so a button
 * here does what it does under Do next. Moves show at once, as they do on
 * the Home: a row set aside or handed to Dash leaves the list, one brought
 * back leaves Set aside, and the server's redraw then puts each where it is.
 */
export function GoalsInboxView({
  groups,
  laterOn,
  preparable,
  canRun,
}: {
  groups: readonly GoalInboxGroup[];
  laterOn: readonly LaterLaneItem[];
  preparable: readonly string[];
  /** Whether this account can start a run, which Ask Dash on a row needs. */
  canRun: boolean;
}) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [back, setBack] = useState<ReadonlySet<string>>(new Set());
  const toggle = (set: ReadonlySet<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const canPrepare = new Set(canRun ? preparable : []);

  const shown = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !gone.has(keyOf(item))) }))
    .filter((group) => group.items.length + group.dash.length > 0);
  const later = laterOn.filter((item) => !back.has(item.id));
  const cells: InboxCell[] = shown.map((group) => ({
    key: group.key,
    title: group.title,
    count: group.items.length + group.dash.length,
    hint: group.hint,
  }));

  return (
    <div className="space-y-6">
      {cells.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting on you"
          description="A step of yours, a question Dash asked, a flag or a proposal lands here until it is done or answered."
        />
      ) : (
        <InboxOverview cells={cells} />
      )}

      {shown.map((group) => (
        <div key={group.key} id={inboxAnchor(group.key)} className="scroll-mt-bar">
          <Group
            fold
            title={
              <>
                {group.title}
                <span className="tabular ml-2 font-normal text-ink-muted">
                  {group.items.length + group.dash.length}
                </span>
              </>
            }
          >
            <Card>
              <ul className="divide-y divide-border">
                {group.items.map((item) => (
                  <TodayRow
                    key={keyOf(item)}
                    item={item}
                    rank={null}
                    preparable={canPrepare.has(item.id)}
                    onAside={(hidden) => setGone((current) => toggle(current, keyOf(item), hidden))}
                    onHanded={() => setGone((current) => toggle(current, keyOf(item), true))}
                  />
                ))}
                {group.dash.map((item) => (
                  <DashRow key={`dash:${item.id}`} item={item} />
                ))}
              </ul>
            </Card>
          </Group>
        </div>
      ))}

      {/* Shut: these are off you until the day they come back. */}
      {later.length > 0 && (
        <SectionFold title="Set aside" count={later.length} defaultOpen={false}>
          <Card>
            <ul className="divide-y divide-border">
              {later.map((item) => (
                <LaterRow
                  key={`later:${item.id}`}
                  item={item}
                  onBack={(away) => setBack((current) => toggle(current, item.id, away))}
                />
              ))}
            </ul>
          </Card>
        </SectionFold>
      )}
    </div>
  );
}

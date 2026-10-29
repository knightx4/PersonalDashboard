'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { Property } from '@/components/shell/detail-layout';
import { Card } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { FieldError, FieldHint, Input, Switch } from '@/components/ui/field';
import { SectionLabel } from '@/components/ui/section-heading';
import { PANEL_NAME_MAX, PANEL_SIZE_MAX, type BoardPanel } from '@/lib/you/board-panels';
import type { RosterAdvisor } from '@/lib/you/board-advisors';
import { AdvisorMark } from '../../../advisor-mark';

/**
 * One panel of advisors (plan #2561.12), on the detail pattern
 * (components/patterns/list-detail.tsx): the header, the facts, then the
 * panel's name, who sits on it, and a delete at the foot. Each change saves
 * as it is made. Picking the panel on a question seats its advisors there;
 * the seats still join as always.
 */

export type PanelActions = {
  rename: (id: string, name: string) => Promise<{ error: string | null }>;
  setAdvisors: (id: string, advisors: string[]) => Promise<{ error: string | null }>;
  remove: (id: string) => Promise<{ error: string | null }>;
};

export function PanelView({
  panel,
  roster,
  actions,
  subject,
  armDelete = false,
}: {
  panel: BoardPanel;
  roster: readonly RosterAdvisor[];
  actions: PanelActions;
  subject?: Subject;
  /** Draw the delete confirm showing. Only the gallery sets it. */
  armDelete?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(panel.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [members, setMembers] = useState<string[]>(panel.advisors);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const known = members.filter((key) => roster.some((a) => a.key === key));
  const seatCount = known.filter((key) => roster.find((a) => a.key === key)?.kind === 'seat').length;

  const rename = (next: string) => {
    setRenaming(true);
    setNameError(null);
    startTransition(async () => {
      const result = await actions.rename(panel.id, next);
      setRenaming(false);
      if (result.error) setNameError(result.error);
      else setSaved(next.replace(/\s+/g, ' ').trim());
    });
  };

  const toggle = (key: string, on: boolean) => {
    const before = members;
    const next = on ? [...members, key] : members.filter((k) => k !== key);
    setMembers(next);
    setMemberError(null);
    startTransition(async () => {
      const result = await actions.setAdvisors(panel.id, next);
      if (result.error) {
        setMembers(before);
        setMemberError(result.error);
      }
    });
  };

  const seats = roster.filter((a) => a.kind === 'seat');
  const guests = roster.filter((a) => a.kind === 'guest');
  const full = members.length >= PANEL_SIZE_MAX;

  return (
    <DetailPage
      header={
        <PageHeader
          title={
            <PanelTitle
              name={saved}
              error={nameError}
              pending={renaming}
              onSave={(next) => {
                rename(next);
              }}
            />
          }
          subject={subject}
        />
      }
      details={
        known.length === 0 ? (
          <Card padding="dense">
            <p className="text-ui text-ink-muted">Nobody sits on this panel yet. Turn on the advisors you want below; the seats sit on every question unless you turn them off when asking.</p>
          </Card>
        ) : (
          <DetailFacts>
            <Property label="Seats" value={seatCount} />
            <Property label="Guests" value={known.length - seatCount} />
          </DetailFacts>
        )
      }
    >
      <Card padding="none">
        <ul className="divide-y divide-border">
          <li>
            <Group label="Seats">
              {seats.map((a) => (
                <Member key={a.key} advisor={a} on={members.includes(a.key)} full={full} panel={saved} onToggle={toggle} />
              ))}
            </Group>
          </li>
          <li>
            <Group label="Guests">
              {guests.map((a) => (
                <Member key={a.key} advisor={a} on={members.includes(a.key)} full={full} panel={saved} onToggle={toggle} />
              ))}
            </Group>
          </li>
        </ul>
        <div className="card-pad-x pb-3">
          <FieldError id="panel-members-error">{memberError}</FieldError>
        </div>
      </Card>
      <Card padding="standard">
        <ConfirmStep
          align="start"
          prompt="Delete this panel? Questions already asked keep the advisors they were given."
          defaultArmed={armDelete}
          confirmLabel="Yes, delete it"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            const result = await actions.remove(panel.id);
            if (result.error) throw new Error(result.error);
            router.push('/you/board/advisors');
          }}
        >
          Delete panel
        </ConfirmStep>
      </Card>
    </DetailPage>
  );
}

/** The heading, which is also where the panel is renamed: press it, type, press Enter or leave it to save. */
function PanelTitle({
  name,
  error,
  pending,
  onSave,
}: {
  name: string;
  error: string | null;
  pending: boolean;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const finish = (save: boolean) => {
    setEditing(false);
    if (save && draft.trim() && draft.trim() !== name) onSave(draft);
    else setDraft(name);
  };
  if (!editing) {
    return (
      <span className="block">
        <button
          type="button"
          aria-label={`${name}: press to rename the panel`}
          disabled={pending}
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          className="text-left [overflow-wrap:anywhere] hover:underline hover:decoration-border"
        >
          {name}
        </button>
        {error && <FieldError id="panel-name-error">{error}</FieldError>}
      </span>
    );
  }
  return (
    <Input
      aria-label="Panel name"
      value={draft}
      maxLength={PANEL_NAME_MAX}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
    />
  );
}

function Group({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <div className="card-pad-x pb-1 pt-3">
        <SectionLabel as="h2">{label}</SectionLabel>
        {note && <FieldHint>{note}</FieldHint>}
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

function Member({
  advisor: a,
  on,
  full,
  panel,
  onToggle,
}: {
  advisor: RosterAdvisor;
  on: boolean;
  full: boolean;
  panel: string;
  onToggle: (key: string, on: boolean) => void;
}) {
  return (
    <li className="card-pad-x row-pad">
      <label className="flex min-h-11 items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-ui text-ink">
            {a.kind === 'guest' && <AdvisorMark name={a.name} />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{a.name}</span>
          </span>
          {a.kind === 'guest' && (
            <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">{a.question}</span>
          )}
        </span>
        <Switch
          aria-label={`${a.name} sits on ${panel}`}
          checked={on}
          disabled={!on && full}
          onChange={(event) => onToggle(a.key, event.target.checked)}
        />
      </label>
    </li>
  );
}

'use client';

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Upload } from 'lucide-react';
import { RowLink } from '@/components/shell/back-link';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { whenDate } from '@/lib/core/when';
import {
  accountHref,
  accountTitle,
  ageLabel,
  KIND_LABEL,
  SOURCE_LABEL,
  type AccountKind,
  type AccountSummary,
} from '@/lib/finances/accounts';
import type { ImportPreview } from '@/lib/finances/import/store';
import { WALLET_MAX_CHARS } from '@/lib/finances/import/wallet';
import { formatCentsAsDollarsInput, formatMoney } from '@/lib/money';
import { addAccount, commitImport, previewImport } from './import-actions';

const UTC = { timeZone: 'UTC' } as const;

/**
 * What importing a statement is doing. The gallery draws each one from a
 * fixture; on the page it starts idle and moves as the file is read.
 */
export type ImportPhase =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string }
  | { kind: 'preview'; fileName: string; text: string; preview: ImportPreview }
  | { kind: 'error'; fileName: string; message: string };

type ImportsState = {
  phase: ImportPhase;
  choose: () => void;
  cancel: () => void;
  confirm: (closingBalance: string) => void;
  importing: boolean;
  error: string | null;
};

const ImportsContext = createContext<ImportsState | null>(null);

function useImports(): ImportsState {
  const state = useContext(ImportsContext);
  if (!state) throw new Error('Import controls sit inside ImportsProvider.');
  return state;
}

/**
 * Holds one import from file to save (plan #2593.5), so the button on the
 * section's heading and the preview under it share it. Choosing a file reads
 * it in the browser and asks the server what it would add; Import sends the
 * same text back, which the server reads again before writing anything.
 */
export function ImportsProvider({
  initialPhase = { kind: 'idle' },
  children,
}: {
  initialPhase?: ImportPhase;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<ImportPhase>(initialPhase);
  const [error, setError] = useState<string | null>(null);
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  async function read(file: File) {
    setError(null);
    setPhase({ kind: 'reading', fileName: file.name });
    if (file.size > WALLET_MAX_CHARS) {
      setPhase({
        kind: 'error',
        fileName: file.name,
        message:
          'The file is too large for a month’s statement. Export one month from Wallet at a time.',
      });
      return;
    }
    const text = await file.text();
    const result = await previewImport(text);
    setPhase(
      result.ok
        ? { kind: 'preview', fileName: file.name, text, preview: result.preview }
        : { kind: 'error', fileName: file.name, message: result.error },
    );
  }

  const state: ImportsState = {
    phase,
    importing,
    error,
    choose: () => fileRef.current?.click(),
    cancel: () => {
      setPhase({ kind: 'idle' });
      setError(null);
    },
    confirm: (closingBalance) => {
      if (phase.kind !== 'preview') return;
      setError(null);
      startImport(async () => {
        const result = await commitImport(
          phase.text,
          closingBalance.trim() === '' ? null : closingBalance,
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPhase({ kind: 'idle' });
        toast({
          text:
            result.added === 0
              ? 'Nothing new: every transaction was already imported.'
              : `Added ${result.added} ${result.added === 1 ? 'transaction' : 'transactions'} to Apple Card.`,
        });
        router.refresh();
      });
    },
  };

  return (
    <ImportsContext.Provider value={state}>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void read(file);
        }}
      />
      {children}
    </ImportsContext.Provider>
  );
}

/** Import statement, on the section's heading line: opens the file picker. */
export function ImportStatementButton() {
  const { phase, choose, importing } = useImports();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={choose}
      disabled={importing}
      pending={phase.kind === 'reading'}
    >
      <Upload className="size-4" strokeWidth={1.75} aria-hidden />
      Import statement
    </Button>
  );
}

/**
 * The section's content: the import under way, if any, then every account
 * kept by statement or by hand with its balance and age, then Add an
 * account by hand.
 */
export function KeptAccounts({
  accounts,
  today,
  addOpen = false,
}: {
  accounts: readonly AccountSummary[];
  today: string;
  /** Gallery only: draw the add-account popover open. */
  addOpen?: boolean;
}) {
  const { phase } = useImports();
  return (
    <div className="space-y-4">
      {phase.kind === 'preview' ? (
        phase.preview.count === 0 ? (
          <EmptyStatement fileName={phase.fileName} preview={phase.preview} />
        ) : (
          <StatementPreview fileName={phase.fileName} preview={phase.preview} />
        )
      ) : phase.kind === 'error' ? (
        <NotAWalletExport fileName={phase.fileName} message={phase.message} />
      ) : null}

      {accounts.length === 0 ? (
        <div className="space-y-1">
          <p className="text-ui font-medium text-ink">Nothing imported yet</p>
          <p className="text-ui text-ink-muted">
            For Apple Card, open Wallet, tap the card, then Card Balance, pick the month and tap
            Export Transactions. Import the CSV or OFX it saves here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {accounts.map((account) => (
            <KeptAccountRow key={account.id} account={account} />
          ))}
        </ul>
      )}

      <AddAccount today={today} defaultOpen={addOpen} />
    </div>
  );
}

function KeptAccountRow({ account }: { account: AccountSummary }) {
  const title = accountTitle(account);
  return (
    <li className="relative has-[a:hover]:bg-sunken">
      <RowLink href={accountHref(account.id)} className="absolute inset-0">
        <span className="sr-only">{title}</span>
      </RowLink>
      <div className="row-pad pointer-events-none relative space-y-0.5">
        <p className="flex items-baseline justify-between gap-3">
          <span className="truncate text-body font-medium text-ink">{title}</span>
          <span className="tabular shrink-0 text-ui text-ink">
            {account.balanceCents === null ? '–' : formatMoney(account.balanceCents)}
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-x-1 text-small text-ink-muted">
          <span>
            {[
              account.institutionName ?? KIND_LABEL[account.kind],
              SOURCE_LABEL[account.source],
            ].join(' · ')}
          </span>
          <span aria-hidden>·</span>
          {account.stale ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-caution">
              <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
              {account.readOn
                ? `${ageLabel(account.ageDays)}, time for a new one`
                : 'No balance yet'}
            </span>
          ) : (
            <span className="whitespace-nowrap">{ageLabel(account.ageDays)}</span>
          )}
        </p>
      </div>
    </li>
  );
}

/** "Sep 1 to Sep 30": the days a statement's lines span. */
function spanLabel(preview: ImportPreview): string | null {
  if (!preview.from || !preview.to) return null;
  if (preview.from === preview.to) return whenDate(preview.from, UTC);
  return `${whenDate(preview.from, UTC)} to ${whenDate(preview.to, UTC)}`;
}

const box = 'space-y-3 rounded-card bg-sunken p-4';

/** What the file would add, with its closing balance to confirm, before anything is written. */
function StatementPreview({ fileName, preview }: { fileName: string; preview: ImportPreview }) {
  const { confirm, cancel, importing, error } = useImports();
  const [balance, setBalance] = useState(
    preview.closingBalanceCents === null
      ? ''
      : formatCentsAsDollarsInput(preview.closingBalanceCents),
  );
  const balanceId = useId();
  const span = spanLabel(preview);
  const already = preview.count - preview.newCount;
  const closing = preview.closingOn ? whenDate(preview.closingOn, UTC) : null;

  return (
    <section aria-label="Statement to import" className={box}>
      <div className="space-y-0.5">
        <p className="text-body font-medium text-ink">Apple Card{span ? `, ${span}` : ''}</p>
        <p className="truncate text-small text-ink-muted">{fileName}</p>
      </div>
      <p className="tabular text-ui text-ink">
        {preview.newCount === 0
          ? `All ${preview.count} transactions are already imported.`
          : already === 0
            ? `${preview.count} ${preview.count === 1 ? 'transaction' : 'transactions'} to add.`
            : `${preview.newCount} new of ${preview.count}; ${already} already imported and left as they are.`}
      </p>
      <Field
        id={balanceId}
        label={closing ? `Owed at the close, ${closing}` : 'Owed at the close'}
        hint={
          preview.closingFrom === 'file'
            ? 'From the file.'
            : preview.closingFrom === 'worked out'
              ? 'Worked out from the last statement and this month’s lines. Check it against the statement.'
              : 'A CSV carries no balance. Type it from the statement, or leave it empty to add the transactions alone.'
        }
        error={error}
        className="max-w-60"
      >
        <Input
          id={balanceId}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          className="tabular"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" pending={importing} onClick={() => confirm(balance)}>
          {preview.newCount === 0
            ? 'Save the balance'
            : `Import ${preview.newCount} ${preview.newCount === 1 ? 'transaction' : 'transactions'}`}
        </Button>
        <Button variant="ghost" size="sm" onClick={cancel} disabled={importing}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** A Wallet file with no transactions in it. */
function EmptyStatement({ fileName, preview }: { fileName: string; preview: ImportPreview }) {
  const { choose, cancel, confirm, importing, error } = useImports();
  const balance = preview.closingBalanceCents;
  return (
    <section aria-label="Statement to import" className={box}>
      <div className="space-y-0.5">
        <p className="text-body font-medium text-ink">No transactions in this statement</p>
        <p className="truncate text-small text-ink-muted">{fileName}</p>
      </div>
      <p className="text-ui text-ink-muted">
        {balance === null
          ? 'Wallet exports a month with nothing on the card as a file with no lines. Pick another month, or cancel.'
          : `Nothing was bought or paid that month. The file still gives the balance owed, ${formatMoney(balance)}, which can be saved on its own.`}
      </p>
      {error ? <p className="text-small text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {balance === null ? (
          <Button size="sm" onClick={choose}>
            Choose another file
          </Button>
        ) : (
          <Button
            size="sm"
            pending={importing}
            onClick={() => confirm(formatCentsAsDollarsInput(balance))}
          >
            Save the balance
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={cancel} disabled={importing}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** A file that is not what Wallet exports, naming what was expected. */
function NotAWalletExport({ fileName, message }: { fileName: string; message: string }) {
  const { choose, cancel } = useImports();
  return (
    <Banner tone="bad" role="alert">
      <span className="block space-y-2">
        <span className="block">
          <span className="font-medium">{fileName} could not be imported.</span> {message}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={choose}>
            Choose another file
          </Button>
          <Button variant="ghost" size="sm" onClick={cancel}>
            Dismiss
          </Button>
        </span>
      </span>
    </Banner>
  );
}

const KIND_CHOICES: readonly AccountKind[] = [
  'checking',
  'savings',
  'credit_card',
  'brokerage',
  'loan',
];

/** Add an account by hand, and the form it opens in place: a name, a kind, where it is held and its balance. */
function AddAccount({ today, defaultOpen }: { today: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('savings');
  const [held, setHeld] = useState('');
  const [balance, setBalance] = useState('');
  const [day, setDay] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSaving] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const ids = { name: useId(), kind: useId(), held: useId(), balance: useId(), day: useId() };
  const owed = kind === 'credit_card' || kind === 'loan';

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      const result = await addAccount({ name, kind, institutionName: held, balance, readOn: day });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setName('');
      setHeld('');
      setBalance('');
      toast({ text: `Added ${name.trim()}. Finances asks for a new balance after 35 days.` });
      router.refresh();
    });
  }

  if (!open)
    return (
      <Button
        type="button"
        variant="link"
        aria-expanded={false}
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
        className="text-ui"
      >
        Add an account by hand
      </Button>
    );

  // Opens in place, under the rows, so the form is never cut off at the foot
  // of a phone's page as a popover hanging below the card would be.
  return (
    <section aria-label="Add an account by hand" className={box}>
      <p className="text-body font-medium text-ink">Add an account by hand</p>
      <form onSubmit={save} className="space-y-3 sm:max-w-md">
        <Field id={ids.name} label="Name">
          <Input
            id={ids.name}
            autoComplete="off"
            placeholder="High-yield savings"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id={ids.kind} label="Kind">
            <Select
              id={ids.kind}
              value={kind}
              onChange={(e) => setKind(e.target.value as AccountKind)}
            >
              {KIND_CHOICES.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.held} label="Held at">
            <Input
              id={ids.held}
              autoComplete="off"
              placeholder="Optional"
              value={held}
              onChange={(e) => setHeld(e.target.value)}
            />
          </Field>
          <Field id={ids.balance} label={owed ? 'Amount owed' : 'Balance'}>
            <Input
              id={ids.balance}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field id={ids.day} label="As of">
            <Input
              id={ids.day}
              type="date"
              max={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" pending={pending}>
            Add account
          </Button>
        </div>
      </form>
    </section>
  );
}

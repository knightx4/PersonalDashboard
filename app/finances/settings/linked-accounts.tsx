'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnEventMetadata,
  type PlaidLinkOnSuccessMetadata,
  type PlaidLinkStableEvent,
} from 'react-plaid-link';
import { ActionMenu } from '@/components/ui/action-menu';
import { Banner } from '@/components/ui/banner';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { whenDate } from '@/lib/core/when';
import { duplicateReason, ITEMS_AMBER_AT, TRIAL_ITEMS, type LinkKind } from '@/lib/finances/plaid/link';
import { completeFix, completeLink, createFixToken, createLinkToken } from './actions';

/** One institution linked through Plaid, as the settings page lists it. */
export type LinkedInstitution = {
  id: string;
  institutionId: string | null;
  institutionName: string;
  needsUpdate: boolean;
  lastError: string | null;
  linkedAt: string;
  lastSyncedAt: string | null;
  accounts: { name: string; mask: string | null }[];
};

/**
 * What linking is doing. The gallery draws each one from a fixture; on the
 * page it starts idle and moves as Plaid and the actions answer.
 */
export type LinkPhase =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'saving'; institutionName: string }
  | { kind: 'error'; message: string }
  | { kind: 'linked'; message: string };

const KIND_LABEL: Record<LinkKind, string> = {
  bank: 'A bank or card',
  brokerage: 'A brokerage',
  loan: 'A loan',
};

const DAY = { timeZone: 'UTC' } as const;

/** Accounts named on a link's row before the rest are counted. */
const ACCOUNTS_SHOWN = 2;
/** The same on a phone, where the row's menu leaves less room. */
const ACCOUNTS_SHOWN_PHONE = 1;

/** Saved across Chase's OAuth sign-in, which leaves the page and comes back. */
const PENDING_KEY = 'finances.plaid.pending';
type Pending = { token: string; fixLinkId: string | null; redirect?: string };

function readPending(): Pending | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

function writePending(pending: Pending | null) {
  try {
    if (pending) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Without storage an OAuth sign-in starts over; nothing else changes.
  }
}

type Linking = {
  links: LinkedInstitution[];
  itemsUsed: number;
  configured: boolean;
  phase: LinkPhase;
  busy: boolean;
  startLink: (kind: LinkKind) => void;
  startFix: (linkId: string) => void;
};

const LinkingContext = createContext<Linking | null>(null);

function useLinking(): Linking {
  const value = useContext(LinkingContext);
  if (!value) throw new Error('useLinking outside LinkingProvider');
  return value;
}

/**
 * Holds linking's state for the section's action and its list, which the
 * settings card draws in two places (the heading's line and the body), and
 * opens Plaid Link when a token arrives.
 */
export function LinkingProvider({
  links,
  itemsUsed,
  configured,
  initialPhase = { kind: 'idle' },
  children,
}: {
  links: LinkedInstitution[];
  /** Every Item ever made, removed ones included: a removed one keeps its slot. */
  itemsUsed: number;
  /** False until Plaid's keys are set. */
  configured: boolean;
  initialPhase?: LinkPhase;
  children: ReactNode;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<LinkPhase>(initialPhase);
  // Back from an OAuth sign-in: Plaid sends the person here with an
  // oauth_state_id, and Link resumes on the same token. The launcher draws
  // nothing, so reading the URL on first render cannot mismatch the server's.
  const [pending, setPending] = useState<Pending | null>(() => {
    if (typeof window === 'undefined') return null;
    if (!new URL(window.location.href).searchParams.has('oauth_state_id')) return null;
    const saved = readPending();
    return saved ? { ...saved, redirect: window.location.href } : null;
  });

  const begin = useCallback(async (run: () => ReturnType<typeof createLinkToken>, fixLinkId: string | null) => {
    setPhase({ kind: 'opening' });
    const result = await run();
    if (!result.ok) {
      setPhase({ kind: 'error', message: result.error });
      return;
    }
    const next = { token: result.linkToken, fixLinkId };
    writePending(next);
    setPending(next);
  }, []);

  const finish = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata, fixLinkId: string | null) => {
      writePending(null);
      setPending(null);
      const name = metadata.institution?.name ?? 'your bank';
      setPhase({ kind: 'saving', institutionName: name });
      if (fixLinkId) {
        const result = await completeFix(fixLinkId);
        setPhase(
          result.ok ? { kind: 'linked', message: `${name} is signed in again.` } : { kind: 'error', message: result.error },
        );
      } else {
        const result = await completeLink({
          publicToken,
          institutionId: metadata.institution?.institution_id ?? null,
          institutionName: metadata.institution?.name ?? null,
        });
        setPhase(
          result.ok
            ? {
                kind: 'linked',
                message: `${result.institutionName} linked, with ${result.accounts} ${result.accounts === 1 ? 'account' : 'accounts'}.`,
              }
            : { kind: 'error', message: result.error },
        );
      }
      router.refresh();
    },
    [router],
  );

  const linkedIds = new Set(links.map((l) => l.institutionId).filter(Boolean));
  const value: Linking = {
    links,
    itemsUsed,
    configured,
    phase,
    busy: phase.kind === 'opening' || phase.kind === 'saving',
    startLink: (kind) => void begin(() => createLinkToken(kind), null),
    startFix: (linkId) => void begin(() => createFixToken(linkId), linkId),
  };

  return (
    <LinkingContext.Provider value={value}>
      {children}
      {pending ? (
        <PlaidLauncher
          token={pending.token}
          receivedRedirectUri={pending.redirect}
          onEvent={(event, metadata) => {
            // Refused before Plaid makes an Item, so no slot is spent.
            if (pending.fixLinkId || event !== 'SELECT_INSTITUTION') return false;
            const id = metadata.institution_id;
            if (!id || !linkedIds.has(id)) return false;
            const held = links.find((l) => l.institutionId === id);
            setPhase({
              kind: 'error',
              message: duplicateReason(held?.institutionName ?? metadata.institution_name ?? 'That bank'),
            });
            return true;
          }}
          onSuccess={(token, metadata) => void finish(token, metadata, pending.fixLinkId)}
          onExit={(error) => {
            writePending(null);
            setPending(null);
            setPhase((current) =>
              current.kind === 'error'
                ? current
                : error
                  ? { kind: 'error', message: error.display_message || error.error_message }
                  : { kind: 'idle' },
            );
          }}
        />
      ) : null}
    </LinkingContext.Provider>
  );
}

/** Link account, on the section heading's line: what kind to link, then Plaid. */
export function LinkAccountMenu({ menuOpen = false }: { menuOpen?: boolean }) {
  const { configured, itemsUsed, phase, busy, startLink } = useLinking();
  if (!configured || itemsUsed >= TRIAL_ITEMS) return null;
  return (
    <ActionMenu
      label="Link account"
      align="end"
      defaultOpen={menuOpen}
      trigger={
        <span className="flex items-center gap-1.5">
          {phase.kind === 'opening' ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden /> : null}
          Link account
        </span>
      }
      triggerClassName={cn(
        buttonVariants({ variant: 'primary', size: 'sm' }),
        'w-auto',
        busy && 'pointer-events-none opacity-60',
      )}
      items={(Object.keys(KIND_LABEL) as LinkKind[]).map((kind) => ({
        id: kind,
        label: KIND_LABEL[kind],
        onSelect: () => startLink(kind),
      }))}
    />
  );
}

/** The links, then how many of the Trial plan's ten are used. */
export function LinkedAccountsList({ rowMenuOpen }: { rowMenuOpen?: string }) {
  const { links, itemsUsed, configured, phase, busy, startFix } = useLinking();
  const spent = itemsUsed >= TRIAL_ITEMS;
  const removed = Math.max(0, itemsUsed - links.length);

  return (
    <div className="space-y-3">
      {!configured ? <Banner tone="warn">Linking opens once Plaid&rsquo;s keys are set in Vercel.</Banner> : null}

      {phase.kind === 'error' ? (
        <Banner tone="bad" role="alert">
          {phase.message}
        </Banner>
      ) : phase.kind === 'linked' ? (
        <Banner tone="info" role="status">
          {phase.message}
        </Banner>
      ) : null}

      {links.length === 0 && phase.kind !== 'saving' ? (
        <div className="space-y-1">
          <p className="text-ui font-medium text-ink">Nothing linked yet</p>
          <p className="text-ui text-ink-muted">
            Link Chase for checking, savings and both cards, your brokerage for what it holds, and your student loan
            servicer for each loan. Each sign-in uses one of {TRIAL_ITEMS} links.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              busy={busy || !configured}
              menuOpen={rowMenuOpen === link.id}
              onFix={() => startFix(link.id)}
            />
          ))}
          {phase.kind === 'saving' ? (
            // Where the new link's row will appear.
            <li className="row-pad flex items-center gap-2 text-ui text-ink-muted" role="status">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
              Saving {phase.institutionName}&rsquo;s accounts&hellip;
            </li>
          ) : null}
        </ul>
      )}

      {itemsUsed > 0 ? (
        <p
          className={cn(
            'text-small tabular-nums',
            itemsUsed >= ITEMS_AMBER_AT ? 'font-medium text-caution' : 'text-ink-muted',
          )}
        >
          {itemsUsed} of {TRIAL_ITEMS} links used
          {removed > 0 ? `, ${removed} by removed links` : ''}
          {spent
            ? '. A removed link does not give its slot back.'
            : itemsUsed >= ITEMS_AMBER_AT
              ? '. A removed link keeps its slot.'
              : ''}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Total Checking ··4417, Chase Savings ··9020 and 2 more" on a laptop, and
 * one account then the count on a phone, so the line stays one line. A name
 * is never split from its digits.
 */
function AccountSummary({ accounts }: { accounts: LinkedInstitution['accounts'] }) {
  if (accounts.length === 0) return <>No accounts shared</>;
  return (
    <>
      <span className="sm:hidden">
        <AccountNames accounts={accounts} shown={ACCOUNTS_SHOWN_PHONE} />
      </span>
      <span className="hidden sm:inline">
        <AccountNames accounts={accounts} shown={ACCOUNTS_SHOWN} />
      </span>
    </>
  );
}

function AccountNames({ accounts, shown: count }: { accounts: LinkedInstitution['accounts']; shown: number }) {
  const shown = accounts.slice(0, count);
  const more = accounts.length - shown.length;
  return (
    <>
      {shown.map((a, i) => (
        <span key={`${a.name}-${a.mask ?? i}`}>
          {i > 0 ? (more === 0 && i === shown.length - 1 ? ' and ' : ', ') : null}
          <span className="whitespace-nowrap">
            {a.name}
            {a.mask ? ` ··${a.mask}` : ''}
          </span>
        </span>
      ))}
      {more > 0 ? <span className="whitespace-nowrap"> and {more} more</span> : null}
    </>
  );
}

function LinkRow({
  link,
  busy,
  menuOpen,
  onFix,
}: {
  link: LinkedInstitution;
  busy: boolean;
  menuOpen: boolean;
  onFix: () => void;
}) {
  return (
    <li className="row-pad flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-body font-medium text-ink">{link.institutionName}</p>
        <p className="truncate text-small text-ink-muted">
          <AccountSummary accounts={link.accounts} />
        </p>
        {link.needsUpdate ? (
          <p className="text-small text-caution">
            <span className="font-medium">{link.institutionName} asks you to sign in again</span>
            {' · '}
            <Button
              variant="link"
              disabled={busy}
              onClick={onFix}
              className="font-medium text-caution decoration-current"
            >
              Fix sign-in
            </Button>
          </p>
        ) : (
          <p className="text-small text-ink-muted">
            Linked {whenDate(link.linkedAt, DAY)}
            {link.lastSyncedAt ? ` · Synced ${whenDate(link.lastSyncedAt, DAY)}` : ' · Not synced yet'}
          </p>
        )}
      </div>
      {link.needsUpdate ? null : (
        <ActionMenu
          label={`More for ${link.institutionName}`}
          defaultOpen={menuOpen}
          className="shrink-0"
          items={[{ id: 'fix', label: 'Fix sign-in', disabled: busy, onSelect: onFix }]}
        />
      )}
    </li>
  );
}

/** Opens Plaid Link on one token as soon as its script is ready. */
function PlaidLauncher({
  token,
  receivedRedirectUri,
  onEvent,
  onSuccess,
  onExit,
}: {
  token: string;
  receivedRedirectUri?: string;
  /** Returns true to close Link at once. */
  onEvent: (event: PlaidLinkStableEvent | string, metadata: PlaidLinkOnEventMetadata) => boolean;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: (error: PlaidLinkError | null) => void;
}) {
  const exitRef = useRef<((options?: { force?: boolean }) => void) | null>(null);
  const { open, ready, exit } = usePlaidLink({
    token,
    receivedRedirectUri,
    onSuccess: (publicToken, metadata) => {
      if (publicToken) onSuccess(publicToken, metadata);
      else onExit(null);
    },
    onExit: (error) => onExit(error),
    onEvent: (event, metadata) => {
      if (onEvent(event, metadata)) exitRef.current?.({ force: true });
    },
  });
  useEffect(() => {
    exitRef.current = exit;
  }, [exit]);
  const opened = useRef(false);
  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [ready, open]);
  return null;
}

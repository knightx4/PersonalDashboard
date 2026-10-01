'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { FileText, Image as ImageIcon, Mail, Paperclip, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/auth/client';
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_ROLES,
  checkUpload,
  formatBytes,
  groupAttachments,
  isImage,
  ROLE_LABEL,
  type AttachmentRole,
  type AttachmentTarget,
  type AttachmentView,
} from '@/lib/todo/attachments/model';
import {
  attachEmailAction,
  changeAttachmentRole,
  finishAttachmentUpload,
  findEmailsFor,
  loadAttachmentsFor,
  removeAttachment,
  startAttachmentUpload,
  type EmailCandidate,
} from '@/app/todo/attachments/actions';

/**
 * What is attached to one task or event: files the person uploaded, and mail
 * from their Gmail with its tickets (supabase/migrations-todo/0016).
 *
 * Files go from the browser straight to the bucket on a one-use URL, so a
 * large PDF never passes through a server action; the server then records
 * what arrived. An email is attached by the person picking it from a search
 * of their mailboxes, or by asking Dash. The list refreshes through the
 * actions' revalidation, so this holds no copy of what the server knows.
 */
export function AttachmentsSection({
  target,
  items,
  canSearchMail = true,
  onChanged,
}: {
  target: AttachmentTarget;
  items: AttachmentView[];
  /** False when no mailbox is connected, so the button is not offered. */
  canSearchMail?: boolean;
  /** Called after a change, for a holder that keeps the list itself. */
  onChanged?: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const grouped = groupAttachments(items);

  async function upload(files: FileList | File[]) {
    setError(null);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      const checked = checkUpload(file);
      if (!checked.ok) {
        setError(checked.error);
        continue;
      }
      setBusy(checked.name);
      const slot = await startAttachmentUpload(target, {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      if (!slot.ok) {
        setError(slot.error);
        continue;
      }
      const sent = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .uploadToSignedUrl(slot.path, slot.token, file, { contentType: slot.mimeType });
      if (sent.error) {
        setError(`${checked.name} could not be uploaded. Try again.`);
        continue;
      }
      const done = await finishAttachmentUpload(target, {
        id: slot.id,
        name: file.name,
        type: file.type,
        size: file.size,
      });
      if (done.error) setError(done.error);
      else {
        toast({ text: `Attached ${checked.name}.` });
        onChanged?.();
      }
    }
    setBusy(null);
    if (input.current) input.current.value = '';
  }

  function remove(item: AttachmentView) {
    startTransition(async () => {
      const result = await removeAttachment(target, item.id);
      if (result.error) setError(result.error);
      else onChanged?.();
    });
  }

  function retag(item: AttachmentView, role: string) {
    startTransition(async () => {
      const result = await changeAttachmentRole(item.id, role);
      if (result.error) setError(result.error);
      else onChanged?.();
    });
  }

  return (
    <section
      aria-label="Attachments"
      className={cn('mt-4 border-t border-border pt-3', dragging && 'bg-accent-tint')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-ui font-semibold text-ink">
          <Paperclip className="size-4" strokeWidth={1.75} aria-hidden />
          Attachments
          {items.length > 0 && <span className="font-normal text-ink-muted">{items.length}</span>}
        </h3>
        <div className="ml-auto flex gap-2">
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose files to attach"
            onChange={(event) => event.target.files && void upload(event.target.files)}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => input.current?.click()}
          >
            {busy ? `Uploading ${busy}…` : 'Add a file'}
          </Button>
          {canSearchMail && (
            <EmailFinder target={target} onError={setError} onAttached={onChanged} />
          )}
        </div>
      </div>

      {grouped.length === 0 && !busy && (
        <p className="mt-2 text-small text-ink-muted">
          Drop a ticket, a PDF or a photo here, or find the email it came in.
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {grouped.map(({ item, files }) => (
          <li key={item.id}>
            <Row
              item={item}
              pending={pending}
              onRemove={() => remove(item)}
              onRole={(role) => retag(item, role)}
            />
            {item.kind === 'email' && (
              <div className="ml-6">
                {files.map((file) => (
                  <Row
                    key={file.id}
                    item={file}
                    pending={pending}
                    onRemove={() => remove(file)}
                    onRole={(role) => retag(file, role)}
                  />
                ))}
                {item.emailText && (
                  <Disclosure title="The message" meta={item.emailFrom ?? undefined}>
                    <p className="whitespace-pre-wrap text-small text-ink-muted">
                      {item.emailText}
                    </p>
                  </Disclosure>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <FieldError>{error ?? undefined}</FieldError>
    </section>
  );
}

function Row({
  item,
  pending,
  onRemove,
  onRole,
}: {
  item: AttachmentView;
  pending: boolean;
  onRemove: () => void;
  onRole: (role: AttachmentRole) => void;
}) {
  const Icon = item.kind === 'email' ? Mail : isImage(item.mimeType) ? ImageIcon : FileText;
  const href = item.kind === 'file' ? `/todo/attachments/${item.id}` : item.emailGmailUrl;
  const detail =
    item.kind === 'file'
      ? item.sizeBytes != null
        ? formatBytes(item.sizeBytes)
        : null
      : [
          item.emailFrom,
          item.emailSentAt
            ? new Date(item.emailSentAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-ui text-ink hover:text-accent"
          >
            {item.name}
          </a>
        ) : (
          <span className="block truncate text-ui text-ink">{item.name}</span>
        )}
        {detail && <span className="block truncate text-small text-ink-muted">{detail}</span>}
      </div>
      <select
        aria-label={`What ${item.name} is`}
        value={item.role}
        disabled={pending}
        onChange={(event) => onRole(event.target.value as AttachmentRole)}
        className="rounded-control bg-surface px-1.5 py-0.5 text-small text-ink-muted"
      >
        {ATTACHMENT_ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABEL[role]}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={onRemove}
        aria-label={`Remove ${item.name}`}
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
    </div>
  );
}

/** Searches the person's mailboxes for mail about this task or event, and attaches the one they pick. */
function EmailFinder({
  target,
  onError,
  onAttached,
}: {
  target: AttachmentTarget;
  onError: (message: string | null) => void;
  onAttached?: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const [found, setFound] = useState<{ messages: EmailCandidate[]; searched: string } | null>(null);
  const [working, startTransition] = useTransition();

  function search(typed?: string) {
    onError(null);
    startTransition(async () => {
      const result = await findEmailsFor(target, typed);
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setFound({ messages: result.messages, searched: result.searched });
    });
  }

  function attach(message: EmailCandidate) {
    onError(null);
    startTransition(async () => {
      const result = await attachEmailAction(target, message.accountId, message.messageId);
      if (!result.ok) {
        onError(result.error);
        return;
      }
      toast({ text: result.message });
      setOpen(false);
      setFound(null);
      onAttached?.();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen(true);
          search();
        }}
      >
        <Search className="size-4" strokeWidth={1.75} aria-hidden />
        Find the email
      </Button>
    );
  }

  return (
    <div className="basis-full space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          search(words);
        }}
      >
        <Input
          aria-label="Search your email for"
          placeholder={
            found ? `Searched for “${found.searched}”. Try other words` : 'Words from the email'
          }
          value={words}
          onChange={(event) => setWords(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={working}>
          Search
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </form>
      {working && <p className="text-small text-ink-muted">Looking…</p>}
      {found && found.messages.length === 0 && !working && (
        <p className="text-small text-ink-muted">Nothing found for “{found.searched}”.</p>
      )}
      <ul className="space-y-1">
        {found?.messages.map((message) => (
          <li key={`${message.accountId}:${message.messageId}`} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-ui text-ink">
                {message.subject ?? '(no subject)'}
              </span>
              <span className="block truncate text-small text-ink-muted">
                {message.from}
                {message.date
                  ? ` · ${new Date(message.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : ''}
              </span>
            </div>
            <Button type="button" size="sm" disabled={working} onClick={() => attach(message)}>
              Attach
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The same section for a place that does not know its attachments up front,
 * such as a task's edit form among a hundred rows: it asks when it opens. The
 * server action's revalidation does not reach a list held here, so the list
 * is read again after each change the section makes.
 */
export function LoadedAttachments({ target }: { target: AttachmentTarget }) {
  const [state, setState] = useState<{ items: AttachmentView[]; canSearchMail: boolean } | null>(
    null,
  );
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void loadAttachmentsFor({ kind: target.kind, id: target.id }).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [target.kind, target.id, version]);

  if (!state) return null;
  return (
    <AttachmentsSection
      key={version}
      target={target}
      items={state.items}
      canSearchMail={state.canSearchMail}
      onChanged={() => setVersion((v) => v + 1)}
    />
  );
}

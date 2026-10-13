'use client';

import { useId, useImperativeHandle, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { FieldError } from '@/components/ui/field';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENTS_PER_ITEM,
  attachmentSize,
  pastedFileName,
  type UploadedAttachment,
} from '@/lib/attachments/rules';
import { discardUpload, uploadAttachment } from './upload';

/** What a form's message box hands a paste to (note 90a05309). */
export type AddFileHandle = {
  /** Add the files on a paste, if it holds any; true when it did, so the box keeps no text for it. */
  paste: (data: DataTransfer) => boolean;
};

/**
 * The files on a paste, named so each reads apart from the others. A paste
 * that carries text as well, such as a run of a document with a picture in
 * it, is left to the box as text.
 */
export function filesFromPaste(data: DataTransfer, already: number): File[] {
  if (data.getData('text/plain').trim()) return [];
  return Array.from(data.files).map((file, index) => {
    const name = pastedFileName(file.name, file.type, already + index + 1);
    return name === file.name ? file : new File([file], name, { type: file.type });
  });
}

/**
 * "Add a file" for any form that saves a row (plan #1712): the note button,
 * the quick capture and Ask Dash each put one beside their Send.
 *
 * Choosing files uploads them straight away to your folder of the private
 * attachments bucket, and each shows as a chip that can be taken off again.
 * The form gets the uploaded files through `onChange`, or as JSON in a hidden
 * field when `name` is given, and its server action passes them through
 * parseUploadedAttachments to recordAttachments once the row is saved.
 * `onUploadingChange` lets the form hold its submit while a file is still
 * going up. `ref` lets the form's message box pass on a picture pasted into
 * it, which is added as if it had been chosen.
 */
export function AddFile({
  ref,
  value,
  onChange,
  name,
  max = ATTACHMENTS_PER_ITEM,
  disabled = false,
  onUploadingChange,
}: {
  ref?: React.Ref<AddFileHandle>;
  value: readonly UploadedAttachment[];
  onChange: (files: UploadedAttachment[]) => void;
  /** The hidden field the list goes in as JSON, for a form posted as FormData. */
  name?: string;
  max?: number;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const room = max - value.length;

  const choose = async (chosen: File[]) => {
    if (chosen.length === 0) return;
    const problems: string[] = [];
    if (chosen.length > room) {
      problems.push(`Up to ${max} files can go with one item.`);
      chosen = chosen.slice(0, Math.max(0, room));
    }
    setUploading(true);
    onUploadingChange?.(true);
    const added: UploadedAttachment[] = [];
    try {
      for (const result of await Promise.all(chosen.map(uploadAttachment))) {
        if ('file' in result) added.push(result.file);
        else problems.push(result.error);
      }
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
    setErrors(problems);
    if (added.length > 0) onChange([...value, ...added]);
  };

  useImperativeHandle(ref, () => ({
    paste: (data) => {
      if (disabled || uploading) return false;
      const files = filesFromPaste(data, value.length);
      if (files.length === 0) return false;
      void choose(files);
      return true;
    },
  }));

  const remove = (path: string) => {
    onChange(value.filter((file) => file.path !== path));
    void discardUpload(path);
  };

  return (
    <div className="min-w-0 space-y-1.5">
      {name && <input type="hidden" name={name} value={JSON.stringify(value)} />}
      <input
        ref={input}
        id={inputId}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void choose(files);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        pending={uploading}
        disabled={disabled || room <= 0}
        aria-describedby={errors.length > 0 ? errorId : undefined}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden className="size-4" />
        {uploading ? 'Adding…' : 'Add a file'}
      </Button>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Files to add">
          {value.map((file) => (
            <li
              key={file.path}
              className="flex min-w-0 max-w-full items-center gap-1 rounded-control bg-sunken py-0.5 pl-2 pr-0.5 text-small text-ink"
            >
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="shrink-0 text-ink-muted">{attachmentSize(file.size)}</span>
              <IconButton
                size="sm"
                label={`Remove ${file.name}`}
                className="hover:bg-surface"
                disabled={disabled}
                onClick={() => remove(file.path)}
              >
                <X aria-hidden strokeWidth={1.75} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <FieldError id={errorId}>{errors.join(' ')}</FieldError>
      )}
    </div>
  );
}
